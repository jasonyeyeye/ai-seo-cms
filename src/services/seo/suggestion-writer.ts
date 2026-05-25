import { db } from '../../db';
import { suggestions } from '../../db/schema';
import type { Suggestion } from './sensors/types';

export async function writeSuggestion(
  type: string,
  targetType: 'post' | 'topic' | 'entity',
  targetId: number,
  payload: Record<string, unknown>,
  source: string
): Promise<void> {
  await db.insert(suggestions).values({
    type,
    targetType,
    targetId,
    payload: JSON.stringify(payload),
    status: 'pending',
    source,
    createdAt: new Date(),
  });
}

export async function writeSuggestions(suggestionList: Suggestion[]): Promise<void> {
  for (const s of suggestionList) {
    await writeSuggestion(s.type, s.targetType, s.targetId, s.payload, s.source);
  }
}
