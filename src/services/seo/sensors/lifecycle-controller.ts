import { db } from '../../../db';
import { posts, postSeoLogs } from '../../../db/schema';
import { eq, sql, and, gte, isNull } from 'drizzle-orm';
import { writeSuggestions } from '../suggestion-writer';
import type { SensorModule, Suggestion } from './types';

function calculateLifecycle(
  publishedAt: Date,
  gscClicks: number | null
): 'hot' | 'warm' | 'cold' | 'archive' {
  const now = new Date();
  const ageDays = Math.floor((now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60 * 24));

  if (ageDays <= 7 || (gscClicks !== null && gscClicks > 100)) {
    return 'hot';
  }
  if (ageDays <= 30 && gscClicks !== null && gscClicks >= 10) {
    return 'warm';
  }
  if (ageDays <= 90 && (gscClicks === null || gscClicks < 10)) {
    return 'cold';
  }
  return 'archive';
}

export const lifecycleController: SensorModule = {
  name: 'Lifecycle Controller',
  source: 'lifecycle_controller',
  description: 'Calculates article lifecycle stage (hot/warm/cold/archive) and generates noindex suggestions for cold/archive articles.',
  enabled: true,
  async execute(): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];

    const publishedPosts = await db
      .select({
        id: posts.id,
        slug: posts.slug,
        status: posts.status,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(eq(posts.status, 'published'));

    for (const post of publishedPosts) {
      if (!post.publishedAt) continue;

      const latestLog = await db
        .select({
          gscClicks: postSeoLogs.gscClicks,
        })
        .from(postSeoLogs)
        .where(eq(postSeoLogs.postId, post.id))
        .orderBy(sql`${postSeoLogs.recordedAt} DESC`)
        .limit(1);

      const gscClicks = latestLog.length > 0 ? latestLog[0].gscClicks : null;
      const lifecycle = calculateLifecycle(post.publishedAt, gscClicks);

      await db.insert(postSeoLogs).values({
        postId: post.id,
        lifecycleStage: lifecycle,
        gscClicks: gscClicks ?? undefined,
        recordedAt: new Date(),
      });

      if (lifecycle === 'cold' || lifecycle === 'archive') {
        suggestions.push({
          type: 'noindex_suggestion',
          targetType: 'post',
          targetId: post.id,
          payload: {
            reason: `Article is in ${lifecycle} lifecycle stage`,
            currentLifecycle: lifecycle,
            gscClicks,
          },
          source: 'lifecycle_controller',
        });
      }
    }

    await writeSuggestions(suggestions);
    return suggestions;
  },
};
