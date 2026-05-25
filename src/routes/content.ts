import { Elysia, t } from 'elysia';
import { db } from '../db';
import { posts } from '../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { jobQueue } from '../services/queue';
import { generateArticle } from '../services/content/pipeline';
import { publishPostToEdge } from '../services/storage/r2';
import type { GenerationInput } from '../services/ai/service';

export const contentRoutes = new Elysia({ prefix: '/api/content' })

  // Trigger single article generation (async)
  .post('/generate', async ({ body }) => {
    const input = body as GenerationInput;
    const jobId = crypto.randomUUID();

    // Create job and return immediately with 202 Accepted
    jobQueue.create(jobId);

    // Process in background using setImmediate
    setImmediate(async () => {
      try {
        jobQueue.start(jobId);

        // Run the content generation pipeline
        const result = await generateArticle(input);

        // Save to database
        await db.insert(posts).values({
          slug: result.slug,
          title: result.title,
          status: result.eeatSelfScore.overall >= 6 ? 'published' : 'draft',
          contentMd: result.humanizedMd,
          contentHtml: result.seoEnhancedHtml,
          searchableText: result.humanizedMd,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: result.eeatSelfScore.overall >= 6 ? new Date() : null,
        });

        // Publish to R2 if published
        if (result.eeatSelfScore.overall >= 6) {
          await publishPostToEdge(result.slug, result.seoEnhancedHtml);
        }

        jobQueue.complete(jobId, {
          slug: result.slug,
          title: result.title,
          eeatScore: result.eeatSelfScore,
          infoGainCheck: result.infoGainCheck,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        jobQueue.fail(jobId, errorMessage);
        console.error(`Job ${jobId} failed:`, error);
      }
    });

    return new Response(JSON.stringify({ jobId, status: 'accepted' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }, {
    body: t.Object({
      keywords: t.Array(t.String()),
      primaryEntitySlug: t.String(),
      styleTemplateId: t.String(),
      targetWordCount: t.Number({ default: 1200 }),
      contentType: t.Union([
        t.Literal('article'),
        t.Literal('review'),
        t.Literal('comparison'),
        t.Literal('guide'),
      ]),
    }),
  })

  // Batch generation for initial build
  .post('/batch-generate', async ({ body }) => {
    interface BatchTask {
      keywords: string[];
      primaryEntitySlug: string;
      styleTemplateId: string;
      targetWordCount?: number;
      contentType: 'article' | 'review' | 'comparison' | 'guide';
    }

    const { tasks } = body as { tasks: BatchTask[] };
    const results: Array<{ slug?: string; title?: string; error?: string }> = [];

    for (const task of tasks) {
      try {
        const result = await generateArticle({
          ...task,
          targetWordCount: task.targetWordCount || 1200,
        });

        await db.insert(posts).values({
          slug: result.slug,
          title: result.title,
          status: result.eeatSelfScore.overall >= 6 ? 'published' : 'draft',
          contentMd: result.humanizedMd,
          contentHtml: result.seoEnhancedHtml,
          searchableText: result.humanizedMd,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: result.eeatSelfScore.overall >= 6 ? new Date() : null,
        });

        if (result.eeatSelfScore.overall >= 6) {
          await publishPostToEdge(result.slug, result.seoEnhancedHtml);
        }

        results.push({ slug: result.slug, title: result.title });

        // Simple rate limiting between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ error: errorMessage });
      }
    }

    return { processed: results.length, results };
  }, {
    body: t.Object({
      tasks: t.Array(t.Object({
        keywords: t.Array(t.String()),
        primaryEntitySlug: t.String(),
        styleTemplateId: t.String(),
        targetWordCount: t.Optional(t.Number()),
        contentType: t.Union([
          t.Literal('article'),
          t.Literal('review'),
          t.Literal('comparison'),
          t.Literal('guide'),
        ]),
      })),
    }),
  })

  // List posts with pagination and status filter
  .get('/posts', async ({ query }) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const status = query.status as string | undefined;
    const offset = (page - 1) * limit;

    const whereClause = status ? eq(posts.status, status as 'draft' | 'published' | 'archived' | 'noindex') : undefined;

    const postList = await db
      .select()
      .from(posts)
      .where(whereClause)
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(whereClause)
      .get();

    const total = countResult?.count || 0;

    return {
      data: postList,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  })

  // Get single post by slug
  .get('/posts/:slug', async ({ params }) => {
    const post = await db
      .select()
      .from(posts)
      .where(eq(posts.slug, params.slug))
      .limit(1);

    if (post.length === 0) {
      return new Response(JSON.stringify({ error: 'Post not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return post[0];
  })

  // Update post status
  .patch('/posts/:id/status', async ({ params, body }) => {
    const { id } = params;
    const { status } = body as { status: 'draft' | 'published' | 'archived' | 'noindex' };

    const post = await db
      .select()
      .from(posts)
      .where(eq(posts.id, Number(id)))
      .limit(1);

    if (post.length === 0) {
      return new Response(JSON.stringify({ error: 'Post not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updates: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    // Set publishedAt when publishing
    if (status === 'published' && !post[0].publishedAt) {
      updates.publishedAt = new Date();
    }

    await db
      .update(posts)
      .set(updates)
      .where(eq(posts.id, Number(id)));

    // If publishing, upload to R2
    if (status === 'published' && post[0].contentHtml) {
      await publishPostToEdge(post[0].slug, post[0].contentHtml as string);
    }

    return { success: true };
  }, {
    body: t.Object({
      status: t.Union([
        t.Literal('draft'),
        t.Literal('published'),
        t.Literal('archived'),
        t.Literal('noindex'),
      ]),
    }),
  })

  // Get job status
  .get('/jobs/:jobId', ({ params }) => {
    const job = jobQueue.get(params.jobId);
    if (!job) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return job;
  });
