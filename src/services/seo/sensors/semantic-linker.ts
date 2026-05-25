import { db } from '../../../db';
import { posts, postEmbeddings } from '../../../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { writeSuggestions } from '../suggestion-writer';
import type { SensorModule, Suggestion } from './types';

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

export const semanticLinker: SensorModule = {
  name: 'Semantic Internal Linker',
  source: 'semantic_linker',
  description: 'Generates embeddings for posts and finds similar posts via cosine similarity for internal linking suggestions.',
  enabled: true,
  async execute(): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    const SIMILARITY_THRESHOLD = 0.75;

    const publishedPosts = await db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        contentMd: posts.contentMd,
      })
      .from(posts)
      .where(eq(posts.status, 'published'));

    for (const post of publishedPosts) {
      let embedding: number[] | null = null;

      const existingEmbedding = await db
        .select({ embedding: postEmbeddings.embedding })
        .from(postEmbeddings)
        .where(eq(postEmbeddings.postId, post.id))
        .limit(1);

      if (existingEmbedding.length > 0) {
        embedding = JSON.parse(existingEmbedding[0].embedding);
      } else {
        try {
          const { AIService } = await import('../../ai/service');
          embedding = await AIService.embed(post.title + ' ' + post.contentMd.slice(0, 1000));

          await db.insert(postEmbeddings).values({
            postId: post.id,
            embedding: JSON.stringify(embedding),
            model: 'bge-small-en-v1.5',
            createdAt: new Date(),
          });
        } catch (error) {
          console.error('[Semantic Linker] Embedding generation failed:', error);
          continue;
        }
      }

      if (!embedding) continue;

      for (const otherPost of publishedPosts) {
        if (otherPost.id === post.id) continue;

        const otherEmbedding = await db
          .select({ embedding: postEmbeddings.embedding })
          .from(postEmbeddings)
          .where(eq(postEmbeddings.postId, otherPost.id))
          .limit(1);

        if (otherEmbedding.length === 0) continue;

        const otherEmbeddingVec = JSON.parse(otherEmbedding[0].embedding);
        const similarity = cosineSimilarity(embedding, otherEmbeddingVec);

        if (similarity >= SIMILARITY_THRESHOLD) {
          suggestions.push({
            type: 'internal_link',
            targetType: 'post',
            targetId: post.id,
            payload: {
              reason: `Similarity ${(similarity * 100).toFixed(1)}% with "${otherPost.title}"`,
              linkedPostId: otherPost.id,
              linkedPostSlug: otherPost.slug,
              similarity: Number(similarity.toFixed(3)),
            },
            source: 'semantic_linker',
          });
        }
      }
    }

    await writeSuggestions(suggestions);
    return suggestions;
  },
};
