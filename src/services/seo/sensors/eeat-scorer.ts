import { db } from '../../../db';
import { posts, postSeoLogs } from '../../../db/schema';
import { eq, and, gte, isNull, sql } from 'drizzle-orm';
import { writeSuggestions } from '../suggestion-writer';
import type { SensorModule, Suggestion } from './types';

interface EEATScores {
  experience: number;
  expertise: number;
  authoritativeness: number;
  trustworthiness: number;
  overall: number;
}

async function scoreEEAT(contentMd: string, title: string): Promise<EEATScores> {
  const prompt = `You are an SEO expert evaluating article quality. Analyze this article for E-E-A-T signals.

Title: ${title}

Content (first 2000 chars): ${contentMd.slice(0, 2000)}

Evaluate each E-E-A-T dimension on a scale of 1-10:
- Experience: Does the article show first-hand experience or practical knowledge?
- Expertise: Does it demonstrate deep knowledge and technical competence?
- Authoritativeness: Is the author recognized as a go-to source in their field?
- Trustworthiness: Is the content accurate, honest, and credible?

Respond with a JSON object:
{
  "experience": <1-10>,
  "expertise": <1-10>,
  "authoritativeness": <1-10>,
  "trustworthiness": <1-10>,
  "overall": <1-10>
}`;

  try {
    const { AIService } = await import('../../ai/service');
    const result = await AIService.generateJSON<EEATScores>(prompt, {
      temperature: 0.3,
      maxTokens: 500,
    });
    return result;
  } catch (error) {
    console.error('[EEAT Scorer] AI scoring failed:', error);
    return { experience: 5, expertise: 5, authoritativeness: 5, trustworthiness: 5, overall: 5 };
  }
}

export const eeatScorer: SensorModule = {
  name: 'E-E-A-T Scorer',
  source: 'eeat_scorer',
  description: 'AI-powered E-E-A-T scoring for articles published in last 24 hours. Generates quality_rejection if overall score < 6.',
  enabled: true,
  async execute(): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    const QUALITY_THRESHOLD = 6;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentPosts = await db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        contentMd: posts.contentMd,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(and(eq(posts.status, 'published'), gte(posts.publishedAt, oneDayAgo)));

    for (const post of recentPosts) {
      const existingScore = await db
        .select({ eeatScore: postSeoLogs.eeatScore })
        .from(postSeoLogs)
        .where(eq(postSeoLogs.postId, post.id))
        .orderBy(sql`${postSeoLogs.recordedAt} DESC`)
        .limit(1);

      if (existingScore.length > 0 && existingScore[0].eeatScore !== null) {
        continue;
      }

      const scores = await scoreEEAT(post.contentMd, post.title);

      await db.insert(postSeoLogs).values({
        postId: post.id,
        eeatScore: scores.overall,
        recordedAt: new Date(),
      });

      if (scores.overall < QUALITY_THRESHOLD) {
        suggestions.push({
          type: 'quality_rejection',
          targetType: 'post',
          targetId: post.id,
          payload: {
            reason: `E-E-A-T overall score ${scores.overall} is below threshold ${QUALITY_THRESHOLD}`,
            eeatScores: scores,
          },
          source: 'eeat_scorer',
        });
      }
    }

    await writeSuggestions(suggestions);
    return suggestions;
  },
};
