/**
 * Affiliate redirect routes for Cloudflare Workers
 *
 * Endpoints:
 * - GET /go/:token - Affiliate redirect with click logging
 */

import type { Env } from '../index';
import { errorResponse } from '../middleware/common';

// Rate limiting for clicks
const CLICK_RATE_LIMIT = 5;
const CLICK_RATE_WINDOW_MS = 60000;

/**
 * GET /go/:token - Affiliate redirect
 */
export async function handleAffiliateRedirect(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const match = pathname.match(/^\/go\/([^/]+)$/);

  if (!match) {
    return errorResponse('Invalid affiliate link', 400);
  }

  const token = match[1];

  // Get affiliate link by token
  const link = await env.DB.prepare(
    `SELECT al.id, al.destination_url, al.platform, al.click_count,
            pp.id as platform_product_id
     FROM affiliate_links al
     LEFT JOIN platform_products pp ON pp.affiliate_token = al.token
     WHERE al.token = ? AND al.deleted_at IS NULL
     LIMIT 1`
  ).bind(token).first();

  if (!link) {
    return errorResponse('Affiliate link not found', 404);
  }

  const ip = request.headers.get('X-Forwarded-For') || request.headers.get('CF-Connecting-IP') || null;
  const userAgent = request.headers.get('User-Agent');
  const referer = request.headers.get('Referer');

  // Rate limit check: same IP per link per minute
  if (ip) {
    const oneMinuteAgo = new Date(Date.now() - CLICK_RATE_WINDOW_MS).toISOString();

    const recentClicks = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM affiliate_clicks
       WHERE link_id = ? AND ip = ? AND clicked_at > ?`
    ).bind(link.id, ip, oneMinuteAgo).first();

    if ((recentClicks?.count as number || 0) >= CLICK_RATE_LIMIT) {
      return errorResponse('Rate limit exceeded. Please wait before clicking again.', 429);
    }
  }

  // Record the click with retry logic
  let clickRecorded = false;
  for (let attempt = 0; attempt < 3 && !clickRecorded; attempt++) {
    try {
      await env.DB.prepare(
        `INSERT INTO affiliate_clicks (id, link_id, ip, user_agent, referer, clicked_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        link.id,
        ip,
        userAgent,
        referer
      ).run();
      clickRecorded = true;
    } catch (err) {
      if (attempt === 2) {
        console.error('[Affiliates] Failed to record click after retries:', err);
      } else {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }

  // Update click count
  await env.DB.prepare(
    `UPDATE affiliate_links SET click_count = click_count + 1, last_click_at = datetime('now') WHERE id = ?`
  ).bind(link.id).run();

  // Also log to affiliate_click_logs if platform_product_id exists
  if (link.platform_product_id) {
    const region = request.headers.get('CF-IPCountry') || null;
    try {
      await env.DB.prepare(
        `INSERT INTO affiliate_click_logs (id, platform_product_id, ip_hash, user_agent, referer, region, clicked_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(),
        link.platform_product_id,
        ip ? hashIP(ip) : null,
        userAgent,
        referer,
        region
      ).run();
    } catch (err) {
      console.warn('[Affiliates] Failed to log to affiliate_click_logs:', err);
    }
  }

  // Redirect to destination
  return Response.redirect(link.destination_url as string, 302);
}

function hashIP(ip: string): string {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}
