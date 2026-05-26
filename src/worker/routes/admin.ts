/**
 * Admin dashboard routes for Cloudflare Workers
 *
 * Endpoints:
 * - GET /api/admin/dashboard - Dashboard statistics
 */

import type { Env } from '../index';
import { getQueryParams, successResponse } from '../middleware/common';

/**
 * GET /api/admin/dashboard - Dashboard statistics
 */
export async function handleAdminDashboard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Run queries in parallel
    const [
      statusCounts,
      recentProducts,
      apiUsageToday,
    ] = await Promise.all([
      // Count products by status
      env.DB.prepare(
        `SELECT is_published, COUNT(*) as count FROM products WHERE is_deleted = 0 GROUP BY is_published`
      ).all(),

      // Recent products
      env.DB.prepare(
        `SELECT id, name, slug, brand, created_at FROM products
         WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 10`
      ).all(),

      // API usage today (if table exists)
      env.DB.prepare(
        `SELECT SUM(tokens_used) as tokens, SUM(cost_estimated) as cost, COUNT(*) as requests
         FROM api_usage_logs WHERE created_at >= ?`
      ).bind(todayStart.toISOString()).first(),
    ]);

    // Calculate suggestion stats if table exists
    let suggestionStats = { pending: 0, approved: 0, rejected: 0, executed: 0 };
    try {
      const suggestions = await env.DB.prepare(
        `SELECT status, COUNT(*) as count FROM suggestions GROUP BY status`
      ).all();

      for (const s of suggestions.results || []) {
        const status = s.status as string;
        if (status in suggestionStats) {
          suggestionStats[status as keyof typeof suggestionStats] = s.count as number;
        }
      }
    } catch {
      // Table might not exist
    }

    // Calculate affiliate stats if tables exist
    let affiliateStats = { totalLinks: 0, totalClicks: 0 };
    try {
      const affiliates = await env.DB.prepare(
        `SELECT COUNT(*) as links, SUM(click_count) as clicks FROM affiliate_links WHERE deleted_at IS NULL`
      ).first();
      if (affiliates) {
        affiliateStats.totalLinks = (affiliates.links as number) || 0;
        affiliateStats.totalClicks = (affiliates.clicks as number) || 0;
      }
    } catch {
      // Tables might not exist
    }

    // Calculate subscriber stats if table exists
    let subscriberStats = { total: 0, active: 0 };
    try {
      const subs = await env.DB.prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM subscribers`
      ).first();
      if (subs) {
        subscriberStats.total = (subs.total as number) || 0;
        subscriberStats.active = (subs.active as number) || 0;
      }
    } catch {
      // Table might not exist
    }

    return successResponse({
      products: {
        published: (statusCounts.results || []).find((s: Record<string, unknown>) => s.is_published === 1)?.count || 0,
        draft: (statusCounts.results || []).find((s: Record<string, unknown>) => s.is_published === 0)?.count || 0,
        recent: recentProducts.results || [],
      },
      suggestions: suggestionStats,
      affiliates: affiliateStats,
      subscribers: subscriberStats,
      apiUsage: {
        today: {
          tokens: (apiUsageToday?.tokens as number) || 0,
          cost: (apiUsageToday?.cost as number) || 0,
          requests: (apiUsageToday?.requests as number) || 0,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Admin] Dashboard error:', err);
    return successResponse({
      products: { published: 0, draft: 0, recent: [] },
      suggestions: { pending: 0, approved: 0, rejected: 0, executed: 0 },
      affiliates: { totalLinks: 0, totalClicks: 0 },
      subscribers: { total: 0, active: 0 },
      apiUsage: { today: { tokens: 0, cost: 0, requests: 0 } },
      timestamp: new Date().toISOString(),
    });
  }
}
