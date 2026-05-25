import { Elysia, t } from 'elysia';
import { db } from '../db';
import { posts, postRatings } from '../db/schema';
import { eq, sql, and, gte } from 'drizzle-orm';

export const ratingRoutes = new Elysia({ prefix: '/api' })

  // Submit a rating (1-5 stars)
  .post('/ratings', async ({ body, request, set }) => {
    const { slug, score } = body as { slug: string; score: number };
    const ip = request.headers.get('X-Forwarded-For') || request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await hashIP(ip);

    // Check if post exists
    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug)
    });

    if (!post) {
      set.status = 404;
      return { error: 'Post not found' };
    }

    // Rate limit: 1 rating per IP per post per hour
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentRating = await db.query.postRatings.findFirst({
      where: and(
        eq(postRatings.postId, post.id),
        eq(postRatings.ipHash, ipHash),
        gte(postRatings.createdAt, oneHourAgo)
      )
    });

    if (recentRating) {
      set.status = 429;
      return { error: 'Rate limit exceeded. Try again later.' };
    }

    // Insert the rating
    await db.insert(postRatings).values({
      postId: post.id,
      score,
      ipHash,
      createdAt: new Date(),
    });

    // Calculate aggregate
    const aggregate = await db
      .select({
        avgScore: sql<number>`AVG(score)`,
        totalCount: sql<number>`COUNT(*)`
      })
      .from(postRatings)
      .where(eq(postRatings.postId, post.id))
      .get();

    // Trigger D1 sync (async - fire and forget)
    syncRatingToD1(slug, aggregate?.avgScore ?? 0, aggregate?.totalCount ?? 0).catch(console.error);

    return {
      success: true,
      avgScore: Number(aggregate?.avgScore?.toFixed(1) ?? 0),
      totalCount: aggregate?.totalCount ?? 0
    };
  }, {
    body: t.Object({
      slug: t.String(),
      score: t.Number({ minimum: 1, maximum: 5 }),
    })
  })

  // Get aggregate rating for a post
  .get('/ratings/:slug', async ({ params }) => {
    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, params.slug)
    });

    if (!post) {
      return new Response(JSON.stringify({ error: 'Post not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const aggregate = await db
      .select({
        avgScore: sql<number>`AVG(score)`,
        totalCount: sql<number>`COUNT(*)`
      })
      .from(postRatings)
      .where(eq(postRatings.postId, post.id))
      .get();

    return {
      slug: params.slug,
      avgScore: aggregate?.avgScore ? Number(aggregate.avgScore.toFixed(1)) : null,
      totalCount: aggregate?.totalCount ?? 0,
    };
  });

// Simple IP hashing using Web Crypto API (no external library needed)
async function hashIP(ip: string): Promise<string> {
  const msg = new TextEncoder().encode(ip + 'secret-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sync rating to D1 for Worker access (async, non-blocking)
async function syncRatingToD1(slug: string, avgScore: number, totalCount: number): Promise<void> {
  // This would call D1 API or update a local sync table
  // For now, just log it - actual D1 sync happens via scripts/sync-to-d1.ts
  console.log(`[Rating Sync] ${slug}: avg=${avgScore}, count=${totalCount}`);
}

// Generate rating widget HTML for injection into articles
export function generateRatingWidgetHtml(slug: string): string {
  return `<!-- Rating Widget -->
<div class="rating-widget my-8 p-6 bg-gray-50 rounded-lg" data-post-slug="${slug}">
  <h3 class="text-lg font-semibold mb-3">Rate this article</h3>
  <div class="flex items-center gap-1 text-2xl">
    <span class="star cursor-pointer hover:scale-110 transition-transform" data-score="1" onclick="submitRating('${slug}', 1)">☆</span>
    <span class="star cursor-pointer hover:scale-110 transition-transform" data-score="2" onclick="submitRating('${slug}', 2)">☆</span>
    <span class="star cursor-pointer hover:scale-110 transition-transform" data-score="3" onclick="submitRating('${slug}', 3)">☆</span>
    <span class="star cursor-pointer hover:scale-110 transition-transform" data-score="4" onclick="submitRating('${slug}', 4)">☆</span>
    <span class="star cursor-pointer hover:scale-110 transition-transform" data-score="5" onclick="submitRating('${slug}', 5)">☆</span>
  </div>
  <p class="text-sm text-gray-500 mt-2">
    Average: <span id="avg-rating-${slug}">-</span> (<span id="rating-count-${slug}">0</span> votes)
  </p>
  <p id="rating-message-${slug}" class="text-sm text-green-600 mt-2 hidden">Thanks for your rating!</p>
</div>

<script>
async function submitRating(slug, score) {
  try {
    const res = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, score })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('avg-rating-' + slug).textContent = data.avgScore;
      document.getElementById('rating-count-' + slug).textContent = data.totalCount;
      document.getElementById('rating-message-' + slug).classList.remove('hidden');
      // Disable further clicks
      document.querySelectorAll('[data-post-slug="' + slug + '"] .star').forEach(s => {
        s.style.pointerEvents = 'none';
        s.style.opacity = '0.5';
      });
    } else if (data.error) {
      alert(data.error);
    }
  } catch (e) {
    console.error('Rating submission failed:', e);
  }
}

// Load existing ratings on page load
fetch('/api/ratings/${slug}')
  .then(r => r.json())
  .then(data => {
    if (data.avgScore) {
      document.getElementById('avg-rating-${slug}').textContent = data.avgScore;
      document.getElementById('rating-count-${slug}').textContent = data.totalCount;
    }
  });
</script>`;
}