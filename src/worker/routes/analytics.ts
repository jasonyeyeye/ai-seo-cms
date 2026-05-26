/**
 * Analytics API routes for Cloudflare Workers
 *
 * Endpoints:
 * - POST /api/analytics - Track events
 * - GET /api/analytics/events - Query events (admin)
 */

import type { Env } from '../index';
import { getQueryParams, errorResponse, successResponse, getClientIP } from '../middleware/common';

/**
 * Hash IP for privacy
 */
function hashIP(ip: string): string {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/**
 * POST /api/analytics - Track events
 */
export async function handleAnalytics(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json() as {
      eventType: string;
      targetType?: string;
      targetId?: string;
      properties?: Record<string, unknown>;
    };

    if (!body.eventType) {
      return errorResponse('eventType required', 400);
    }

    const cfCountry = request.headers.get('CF-IPCountry') || undefined;
    const userAgent = request.headers.get('User-Agent') || undefined;
    const referer = request.headers.get('Referer') || undefined;

    // Get IP hash for privacy
    let ipHash: string | undefined;
    const forwardedFor = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
    if (forwardedFor) {
      ipHash = hashIP(forwardedFor.split(',')[0].trim());
    }

    // Insert analytics event
    await env.DB.prepare(
      `INSERT INTO analytics_events (id, event_type, target_type, target_id, properties, ip_hash, user_agent, referer, region, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(),
      body.eventType,
      body.targetType || null,
      body.targetId || null,
      JSON.stringify(body.properties || {}),
      ipHash || null,
      userAgent || null,
      referer || null,
      cfCountry || null
    ).run();

    return successResponse({ success: true });
  } catch (err) {
    console.error('[Analytics] Error logging event:', err);
    // Don't fail the request for analytics
    return successResponse({ success: true });
  }
}

/**
 * GET /api/analytics/events - Query events (admin only)
 */
export async function handleAnalyticsEvents(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);

  const eventType = params.type;
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 50));

  try {
    let query = `
      SELECT id, event_type, target_type, target_id, properties, region, created_at
      FROM analytics_events
    `;
    const bindings: (string | number)[] = [];

    if (eventType) {
      query += ' WHERE event_type = ?';
      bindings.push(eventType);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    bindings.push(limit);

    const result = await env.DB.prepare(query).bind(...bindings).all();

    return successResponse({
      success: true,
      events: result.results || [],
      count: (result.results || []).length,
    });
  } catch (err) {
    console.error('[Analytics] Error fetching events:', err);
    return errorResponse('Failed to fetch events', 500);
  }
}
