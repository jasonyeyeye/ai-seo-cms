import { db } from '../../../db';
import { posts, postEmbeddings } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { writeSuggestions } from '../suggestion-writer';
import type { SensorModule, Suggestion } from './types';

function titleSimilarity(titleA: string, titleB: string): number {
  const wordsA = new Set(titleA.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(titleB.toLowerCase().split(/\s+/).filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const cannibalDetector: SensorModule = {
  name: 'Cannibalization Detector',
  source: 'cannibal_detector',
  description: 'Detects keyword cannibalization: title similarity > 60% AND vector similarity > 0.85 between articles.',
  enabled: true,
  async execute(): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    const TITLE_SIMILARITY_THRESHOLD = 0.6;
    const VECTOR_SIMILARITY_THRESHOLD = 0.85;

    const publishedPosts = await db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        contentMd: posts.contentMd,
      })
      .from(posts)
      .where(eq(posts.status, 'published'));

    for (let i = 0; i < publishedPosts.length; i++) {
      const postA = publishedPosts[i];

      for (let j = i + 1; j < publishedPosts.length; j++) {
        const postB = publishedPosts[j];

        const titleSim = titleSimilarity(postA.title, postB.title);
        if (titleSim <= TITLE_SIMILARITY_THRESHOLD) continue;

        const embeddingA = await db
          .select({ embedding: postEmbeddings.embedding })
          .from(postEmbeddings)
          .where(eq(postEmbeddings.postId, postA.id))
          .limit(1);

        const embeddingB = await db
          .select({ embedding: postEmbeddings.embedding })
          .from(postEmbeddings)
          .where(eq(postEmbeddings.postId, postB.id))
          .limit(1);

        if (embeddingA.length === 0 || embeddingB.length === 0) continue;

        const vecA = JSON.parse(embeddingA[0].embedding);
        const vecB = JSON.parse(embeddingB[0].embedding);
        const vectorSim = cosineSimilarity(vecA, vecB);

        if (vectorSim >= VECTOR_SIMILARITY_THRESHOLD) {
          suggestions.push({
            type: 'cannibalization',
            targetType: 'post',
            targetId: postA.id,
            payload: {
              reason: `Potential cannibalization: title similarity ${(titleSim * 100).toFixed(1)}%, vector similarity ${(vectorSim * 100).toFixed(1)}%`,
              competingPostId: postB.id,
              competingPostSlug: postB.slug,
              competingPostTitle: postB.title,
              titleSimilarity: Number(titleSim.toFixed(3)),
              vectorSimilarity: Number(vectorSim.toFixed(3)),
            },
            source: 'cannibal_detector',
          });
        }
      }
    }

    await writeSuggestions(suggestions);
    return suggestions;
  },
};
