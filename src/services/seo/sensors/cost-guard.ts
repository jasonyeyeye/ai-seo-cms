import { db } from '../../../db';
import { apiUsageLogs } from '../../../db/schema';
import { eq, sql, gte } from 'drizzle-orm';
import { writeSuggestions } from '../suggestion-writer';
import type { SensorModule, Suggestion } from './types';

const DAILY_BUDGET = parseInt(process.env.DAILY_TOKEN_BUDGET || '200000', 10);
const ALERT_THRESHOLD = 0.8;

export const costGuard: SensorModule = {
  name: 'Cost Guard',
  source: 'cost_guard',
  description: 'Tracks API usage and alerts when daily budget exceeds 80% threshold.',
  enabled: true,
  async execute(): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usage = await db
      .select({
        totalTokens: sql<number>`SUM(${apiUsageLogs.tokensUsed})`,
        estimatedCost: sql<number>`SUM(${apiUsageLogs.costEstimated})`,
      })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, today));

    const totalTokens = usage[0]?.totalTokens || 0;
    const estimatedCost = usage[0]?.estimatedCost || 0;
    const usageRatio = totalTokens > 0 ? estimatedCost / DAILY_BUDGET : 0;

    if (usageRatio >= ALERT_THRESHOLD) {
      suggestions.push({
        type: 'cost_alert',
        targetType: 'post',
        targetId: 0,
        payload: {
          reason: `API usage has reached ${(usageRatio * 100).toFixed(1)}% of daily budget`,
          totalTokens,
          estimatedCost,
          dailyBudget: DAILY_BUDGET,
          usagePercentage: (usageRatio * 100).toFixed(1),
        },
        source: 'cost_guard',
      });
    }

    await writeSuggestions(suggestions);
    return suggestions;
  },
};
