/**
 * Search API routes for Cloudflare Workers
 *
 * Endpoints:
 * - GET /api/search - Full search with KV caching
 * - GET /api/search/autocomplete - Search suggestions
 * - GET /api/search/hot - Hot search terms
 * - POST /api/search/log - Log search query
 */

import type { Env } from '../index';
import { getQueryParams, errorResponse, successResponse } from '../middleware/common';

// Hot search threshold for caching
const HOT_THRESHOLD = 10;

// In-memory search frequency tracking (per-worker, resets on restart)
// For production, use KV with TTL
const searchCounts = new Map<string, number>();

function incrementSearchCount(query: string): number {
  const normalized = query.toLowerCase().trim();
  const count = (searchCounts.get(normalized) || 0) + 1;
  searchCounts.set(normalized, count);
  return count;
}

function highlightMatch(text: string, query: string): string {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * GET /api/search - Full search with KV caching
 */
export async function handleSearch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);

  const q = (params.q || '').trim();
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
  const offset = (page - 1) * limit;

  if (!q || q.length < 2) {
    return successResponse({ success: true, products: [], pagination: { page, limit, total: 0, totalPages: 0 } });
  }

  // Check KV cache first (only for page 1)
  if (page === 1 && env.SEARCH_CACHE) {
    try {
      const cacheKey = `search:${q}:${limit}`;
      const cached = await env.SEARCH_CACHE.get(cacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        const searchCount = incrementSearchCount(q);
        return successResponse({
          success: true,
          query: q,
          products: cachedData.products,
          pagination: {
            page,
            limit,
            total: cachedData.total,
            totalPages: Math.ceil(cachedData.total / limit),
          },
          cached: true,
          searchCount,
        });
      }
    } catch (err) {
      console.warn('[Search] Cache read failed:', err);
    }
  }

  try {
    const searchPattern = `%${q}%`;

    // Search products using D1
    // Note: Using LIKE for case-insensitive search - D1/SQLite LIKE is case-insensitive for ASCII
    const searchCondition = `(name LIKE ? OR brand LIKE ? OR description LIKE ?) AND is_deleted = 0 AND is_published = 1`;

    const rowsResult = await env.DB.prepare(
      `SELECT id, slug, name, brand, brand_slug, category, category_slug, description, summary,
              thumbnail_url, average_rating, review_count, created_at
       FROM products
       WHERE ${searchCondition}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(searchPattern, searchPattern, searchPattern, limit, offset).all();

    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM products WHERE ${searchCondition}`
    ).bind(searchPattern, searchPattern, searchPattern).first();

    const total = (countResult?.count as number) || 0;

    // Enrich with platform data
    const enrichedProducts = await Promise.all(
      (rowsResult.results || []).map(async (product: Record<string, unknown>) => {
        try {
          const platforms = await env.DB.prepare(
            `SELECT platform, current_price, currency, affiliate_token
             FROM platform_products
             WHERE product_id = ? AND is_active = 1`
          ).bind(product.id).all();

          return {
            ...product,
            platforms: platforms.results || [],
          };
        } catch {
          return { ...product, platforms: [] };
        }
      })
    );

    // Track search frequency
    const searchCount = incrementSearchCount(q);

    // Cache results if hot search
    if (page === 1 && searchCount >= HOT_THRESHOLD && env.SEARCH_CACHE) {
      try {
        const cacheKey = `search:${q}:${limit}`;
        await env.SEARCH_CACHE.put(cacheKey, JSON.stringify({ products: enrichedProducts, total }), {
          expirationTtl: 300, // 5 minutes
        });
        console.log(`[Search] Cached results for "${q}" (count: ${searchCount})`);
      } catch (err) {
        console.warn('[Search] Cache write failed:', err);
      }
    }

    return successResponse({
      success: true,
      query: q,
      products: enrichedProducts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      searchCount,
    });
  } catch (err) {
    console.error('[Search] Error:', err);
    return successResponse({
      success: false,
      products: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
      error: String(err),
    });
  }
}

/**
 * GET /api/search/autocomplete - Search suggestions
 */
export async function handleSearchAutocomplete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);

  const q = (params.q || '').trim();
  if (q.length < 2) {
    return successResponse({ success: true, suggestions: [] });
  }

  try {
    const searchPattern = `%${q}%`;

    const rows = await env.DB.prepare(
      `SELECT name, slug, brand
       FROM products
       WHERE is_deleted = 0 AND is_published = 1
         AND (name LIKE ? OR brand LIKE ?)
       ORDER BY average_rating DESC, review_count DESC
       LIMIT 8`
    ).bind(searchPattern, searchPattern).all();

    const suggestions = (rows.results || []).map((row: Record<string, unknown>) => ({
      text: row.name,
      slug: row.slug,
      brand: row.brand,
      highlighted: highlightMatch(row.name as string, q),
    }));

    return successResponse({ success: true, suggestions });
  } catch (err) {
    console.error('[Search Autocomplete] Error:', err);
    return successResponse({ success: true, suggestions: [] });
  }
}

/**
 * GET /api/search/hot - Hot search terms
 */
export async function handleSearchHot(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Return hot searches - in production, this would query analytics
  // For now, return hardcoded hot searches
  return successResponse({
    success: true,
    hotSearches: [
      { query: 'iPhone', count: 100 },
      { query: 'Sony耳机', count: 85 },
      { query: '戴森吸尘器', count: 72 },
      { query: 'Nintendo Switch', count: 65 },
      { query: 'MacBook', count: 58 },
      { query: 'AirPods', count: 52 },
      { query: 'iPad', count: 48 },
    ],
  });
}

/**
 * POST /api/search/log - Log search query
 */
export async function handleSearchLog(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json() as { query?: string };
    const query = body.query?.trim();

    if (!query) {
      return successResponse({ success: false });
    }

    // Log to console - in production, could log to analytics
    console.log('[Search Log]:', query);
    return successResponse({ success: true });
  } catch {
    return successResponse({ success: false });
  }
}
