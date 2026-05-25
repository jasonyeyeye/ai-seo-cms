import { Elysia, t } from 'elysia';
import { db } from '../db';
import { suggestions, posts, postSeoLogs, apiUsageLogs } from '../db/schema';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import {
  executeSuggestion,
  rollbackSuggestion,
  approveSuggestion,
  rejectSuggestion,
} from '../services/seo/execution-engine';
import { getRules, updateRuleEnabled, evaluateAndExecute } from '../services/seo/rule-engine';

export const dashboardRoutes = new Elysia({ prefix: '/api/dashboard' })

  // Get paginated suggestions list
  .get('/suggestions', async ({ query }) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const type = query.type as string | undefined;
    const source = query.source as string | undefined;
    const status = query.status as string | undefined;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (status) conditions.push(eq(suggestions.status, status as 'pending' | 'approved' | 'rejected' | 'executed'));
    if (type) conditions.push(eq(suggestions.type, type));
    if (source) conditions.push(eq(suggestions.source, source));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select()
      .from(suggestions)
      .where(whereClause)
      .orderBy(desc(suggestions.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(suggestions)
      .where(whereClause)
      .get();

    return {
      data: results,
      pagination: {
        page,
        limit,
        total: countResult?.count || 0,
        totalPages: Math.ceil((countResult?.count || 0) / limit),
      },
    };
  })

  // Get single suggestion by ID
  .get('/suggestions/:id', async ({ params }) => {
    const suggestion = await db
      .select()
      .from(suggestions)
      .where(eq(suggestions.id, Number(params.id)))
      .limit(1);

    if (suggestion.length === 0) {
      return new Response(JSON.stringify({ error: 'Suggestion not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse payload JSON
    const result = { ...suggestion[0] };
    try {
      result.payload = JSON.parse(result.payload as string);
    } catch {
      // Keep as string if parse fails
    }

    return result;
  })

  // Batch approve/reject suggestions
  .post('/suggestions/batch', async ({ body }) => {
    interface BatchAction {
      action: 'approve' | 'reject' | 'execute';
      ids: number[];
    }

    const { actions } = body as { actions: BatchAction[] };
    const results: Array<{ id: number; success: boolean; message: string }> = [];

    for (const action of actions) {
      for (const id of action.ids) {
        try {
          let result;
          switch (action.action) {
            case 'approve':
              result = await approveSuggestion(id);
              break;
            case 'reject':
              result = await rejectSuggestion(id);
              break;
            case 'execute':
              result = await executeSuggestion(id);
              break;
            default:
              result = { success: false, message: `Unknown action: ${action.action}` };
          }
          results.push({ id, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.push({ id, success: false, message });
        }
      }
    }

    return { processed: results.length, results };
  }, {
    body: t.Object({
      actions: t.Array(t.Object({
        action: t.Union([t.Literal('approve'), t.Literal('reject'), t.Literal('execute')]),
        ids: t.Array(t.Number()),
      })),
    }),
  })

  // Execute a suggestion
  .post('/suggestions/:id/execute', async ({ params }) => {
    const result = await executeSuggestion(Number(params.id));
    return result;
  })

  // Rollback an executed suggestion
  .post('/suggestions/:id/rollback', async ({ params }) => {
    const result = await rollbackSuggestion(Number(params.id));
    return result;
  })

  // Approve a suggestion
  .post('/suggestions/:id/approve', async ({ params }) => {
    const result = await approveSuggestion(Number(params.id));
    return result;
  })

  // Reject a suggestion
  .post('/suggestions/:id/reject', async ({ params }) => {
    const result = await rejectSuggestion(Number(params.id));
    return result;
  })

  // Get dashboard statistics
  .get('/stats', async () => {
    // Count suggestions by status
    const statusCounts = await db
      .select({
        status: suggestions.status,
        count: sql<number>`count(*)`,
      })
      .from(suggestions)
      .groupBy(suggestions.status);

    // Count suggestions by type
    const typeCounts = await db
      .select({
        type: suggestions.type,
        count: sql<number>`count(*)`,
      })
      .from(suggestions)
      .groupBy(suggestions.type);

    // Count suggestions by source
    const sourceCounts = await db
      .select({
        source: suggestions.source,
        count: sql<number>`count(*)`,
      })
      .from(suggestions)
      .groupBy(suggestions.source);

    // Recent posts stats
    const recentPostsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(eq(posts.status, 'published'))
      .get();

    // Posts by lifecycle stage (from latest post_seo_logs)
    const lifecycleStats = await db
      .select({
        lifecycleStage: postSeoLogs.lifecycleStage,
        count: sql<number>`count(*)`,
      })
      .from(postSeoLogs)
      .groupBy(postSeoLogs.lifecycleStage);

    // API usage today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const apiUsageToday = await db
      .select({
        totalTokens: sql<number>`sum(tokens_used)`,
        totalCost: sql<number>`sum(cost_estimated)`,
        requestCount: sql<number>`count(*)`,
      })
      .from(apiUsageLogs)
      .where(sql`${apiUsageLogs.createdAt} >= ${todayStart}`)
      .get();

    return {
      suggestions: {
        byStatus: Object.fromEntries(statusCounts.map(s => [s.status || 'unknown', s.count])),
        byType: Object.fromEntries(typeCounts.map(t => [t.type, t.count])),
        bySource: Object.fromEntries(sourceCounts.map(s => [s.source, s.count])),
      },
      posts: {
        published: recentPostsCount?.count || 0,
        byLifecycle: Object.fromEntries(lifecycleStats.map(l => [l.lifecycleStage || 'unknown', l.count])),
      },
      apiUsage: {
        today: {
          tokens: apiUsageToday?.totalTokens || 0,
          cost: apiUsageToday?.totalCost || 0,
          requests: apiUsageToday?.requestCount || 0,
        },
      },
    };
  })

  // Get all rules
  .get('/rules', async () => {
    return { rules: getRules() };
  })

  // Update rule enabled status
  .patch('/rules/:id', async ({ params, body }) => {
    const { enabled } = body as { enabled: boolean };
    const success = updateRuleEnabled(params.id, enabled);
    if (!success) {
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return { success: true };
  })

  // Run auto-rules evaluation
  .post('/rules/evaluate', async () => {
    const result = await evaluateAndExecute();
    return result;
  });
