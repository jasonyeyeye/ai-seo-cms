import { db } from '../../db';
import { suggestions, posts } from '../../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { publishPostToEdge } from '../storage/r2';

export type ExecutionResult = {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export async function executeSuggestion(suggestionId: number): Promise<ExecutionResult> {
  const suggestion = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.id, suggestionId))
    .limit(1);

  if (suggestion.length === 0) {
    return { success: false, message: 'Suggestion not found' };
  }

  const s = suggestion[0];
  const payload = JSON.parse(s.payload as string) as Record<string, unknown>;

  switch (s.type) {
    case 'quality_rejection':
      // Mark post as draft for rewriting
      if (s.targetType === 'post' && s.targetId) {
        await db
          .update(posts)
          .set({ status: 'draft', updatedAt: new Date() })
          .where(eq(posts.id, s.targetId));
        return { success: true, message: 'Post marked as draft for rewriting' };
      }
      break;

    case 'noindex_suggestion':
      // Set post status to noindex
      if (s.targetType === 'post' && s.targetId) {
        await db
          .update(posts)
          .set({ status: 'noindex', updatedAt: new Date() })
          .where(eq(posts.id, s.targetId));
        return { success: true, message: 'Post marked as noindex' };
      }
      break;

    case 'internal_link':
      // Internal link suggestions are informational only
      // Actual link insertion would be done manually
      return {
        success: true,
        message: 'Internal link suggestion recorded - execute manually',
        details: { recommendedLinks: payload.recommendedLinks }
      };

    case 'cannibalization':
      // Cannibalization alerts are informational
      return {
        success: true,
        message: 'Cannibalization detected - review manually',
        details: { conflictingPost: payload.conflictingSlug }
      };

    case 'budget_warning':
      // Budget warnings are informational
      return {
        success: true,
        message: 'Budget warning acknowledged',
        details: { percentage: payload.percentage }
      };

    case 'info_gain_failed':
      // Info gain failures are informational
      return {
        success: true,
        message: 'Info gain issue recorded - consider adding more data points',
        details: { elementsFound: payload.elementsFound }
      };

    default:
      return { success: false, message: `Unknown suggestion type: ${s.type}` };
  }

  // Update suggestion status to executed
  await db
    .update(suggestions)
    .set({ status: 'executed', executedAt: new Date() })
    .where(eq(suggestions.id, suggestionId));

  return { success: true, message: 'Suggestion executed successfully' };
}

export async function rollbackSuggestion(suggestionId: number): Promise<ExecutionResult> {
  const suggestion = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.id, suggestionId))
    .limit(1);

  if (suggestion.length === 0) {
    return { success: false, message: 'Suggestion not found' };
  }

  const s = suggestion[0];

  if (s.status !== 'executed') {
    return { success: false, message: 'Can only rollback executed suggestions' };
  }

  switch (s.type) {
    case 'quality_rejection':
    case 'noindex_suggestion':
      // Restore post to published status
      if (s.targetType === 'post' && s.targetId) {
        await db
          .update(posts)
          .set({ status: 'published', updatedAt: new Date() })
          .where(eq(posts.id, s.targetId));

        // Re-publish to R2
        const post = await db
          .select()
          .from(posts)
          .where(eq(posts.id, s.targetId))
          .limit(1);

        if (post[0]?.contentHtml) {
          await publishPostToEdge(post[0].slug, post[0].contentHtml as string);
        }

        await db
          .update(suggestions)
          .set({ status: 'pending', executedAt: null })
          .where(eq(suggestions.id, suggestionId));

        return { success: true, message: 'Rollback complete - post restored to published' };
      }
      break;
  }

  return { success: false, message: `Rollback not supported for type: ${s.type}` };
}

export async function approveSuggestion(suggestionId: number): Promise<ExecutionResult> {
  const suggestion = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.id, suggestionId))
    .limit(1);

  if (suggestion.length === 0) {
    return { success: false, message: 'Suggestion not found' };
  }

  await db
    .update(suggestions)
    .set({ status: 'approved' })
    .where(eq(suggestions.id, suggestionId));

  return { success: true, message: 'Suggestion approved' };
}

export async function rejectSuggestion(suggestionId: number): Promise<ExecutionResult> {
  const suggestion = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.id, suggestionId))
    .limit(1);

  if (suggestion.length === 0) {
    return { success: false, message: 'Suggestion not found' };
  }

  await db
    .update(suggestions)
    .set({ status: 'rejected' })
    .where(eq(suggestions.id, suggestionId));

  return { success: true, message: 'Suggestion rejected' };
}
