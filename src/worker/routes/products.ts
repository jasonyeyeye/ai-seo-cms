/**
 * Product routes for Cloudflare Workers
 *
 * Endpoints:
 * - GET/POST/PUT/DELETE /api/products/crud - Product CRUD
 * - GET /api/products/list - Product listing
 * - GET /api/products/special/deals - Deals page
 */

import type { Env } from '../index';
import { getQueryParams, errorResponse, successResponse } from '../middleware/common';

/**
 * GET/POST/PUT/DELETE /api/products/crud - Product CRUD
 */
export async function handleProductsCrud(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);
  const method = request.method;

  // GET - List or get single product
  if (method === 'GET') {
    const id = params.id;

    if (id) {
      // Get single product
      const product = await env.DB.prepare(
        `SELECT * FROM products WHERE id = ? AND is_deleted = 0`
      ).bind(parseInt(id)).first();

      if (!product) {
        return errorResponse('Product not found', 404);
      }

      // Get platform products
      const platforms = await env.DB.prepare(
        `SELECT platform, current_price, currency, affiliate_url, affiliate_token
         FROM platform_products WHERE product_id = ? AND is_active = 1`
      ).bind(parseInt(id)).all();

      return successResponse({ ...product, platforms: platforms.results || [] });
    }

    // List products with pagination
    const page = Math.max(1, parseInt(params.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
    const offset = (page - 1) * limit;
    const category = params.category;
    const brand = params.brand;

    let whereClause = 'is_deleted = 0 AND is_published = 1';
    const bindings: (string | number)[] = [];

    if (category) {
      whereClause += ' AND category_slug = ?';
      bindings.push(category);
    }
    if (brand) {
      whereClause += ' AND brand_slug = ?';
      bindings.push(brand);
    }

    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM products WHERE ${whereClause}`
    ).bind(...bindings).first();

    const products = await env.DB.prepare(
      `SELECT * FROM products WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...bindings, limit, offset).all();

    return successResponse({
      data: products.results || [],
      pagination: {
        page,
        limit,
        total: (countResult?.count as number) || 0,
        totalPages: Math.ceil(((countResult?.count as number) || 0) / limit),
      },
    });
  }

  // POST - Create product
  if (method === 'POST') {
    try {
      const body = await request.json() as {
        name: string;
        slug: string;
        brand?: string;
        brandSlug?: string;
        category?: string;
        categorySlug?: string;
        description?: string;
        summary?: string;
        pros?: string[];
        cons?: string[];
        faq?: { q: string; a: string }[];
        images?: string[];
        thumbnailUrl?: string;
        isPublished?: boolean;
      };

      if (!body.name || !body.slug) {
        return errorResponse('Name and slug required', 400);
      }

      // Check slug uniqueness
      const existing = await env.DB.prepare(
        'SELECT id FROM products WHERE slug = ? LIMIT 1'
      ).bind(body.slug).first();

      if (existing) {
        return errorResponse('Slug already exists', 400);
      }

      const productId = await env.DB.prepare(
        `INSERT INTO products (slug, name, brand, brand_slug, category, category_slug,
          description, summary, pros, cons, faq, images, thumbnail_url, is_published,
          is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`
      ).bind(
        body.slug,
        body.name,
        body.brand || null,
        body.brandSlug || null,
        body.category || null,
        body.categorySlug || null,
        body.description || null,
        body.summary || null,
        JSON.stringify(body.pros || []),
        JSON.stringify(body.cons || []),
        JSON.stringify(body.faq || []),
        JSON.stringify(body.images || []),
        body.thumbnailUrl || null,
        body.isPublished ? 1 : 0
      ).run();

      return successResponse({ id: productId.meta?.last_row_id, success: true }, 201);
    } catch (err) {
      console.error('[Products] Create error:', err);
      return errorResponse('Failed to create product', 500);
    }
  }

  // PUT - Update product
  if (method === 'PUT') {
    try {
      const body = await request.json() as {
        id: number;
        name?: string;
        slug?: string;
        brand?: string;
        brandSlug?: string;
        category?: string;
        categorySlug?: string;
        description?: string;
        summary?: string;
        pros?: string[];
        cons?: string[];
        faq?: { q: string; a: string }[];
        images?: string[];
        thumbnailUrl?: string;
        isPublished?: boolean;
      };

      if (!body.id) {
        return errorResponse('Product ID required', 400);
      }

      const updates: string[] = [];
      const bindings: (string | number | null)[] = [];

      if (body.name !== undefined) { updates.push('name = ?'); bindings.push(body.name); }
      if (body.slug !== undefined) { updates.push('slug = ?'); bindings.push(body.slug); }
      if (body.brand !== undefined) { updates.push('brand = ?'); bindings.push(body.brand || null); }
      if (body.brandSlug !== undefined) { updates.push('brand_slug = ?'); bindings.push(body.brandSlug || null); }
      if (body.category !== undefined) { updates.push('category = ?'); bindings.push(body.category || null); }
      if (body.categorySlug !== undefined) { updates.push('category_slug = ?'); bindings.push(body.categorySlug || null); }
      if (body.description !== undefined) { updates.push('description = ?'); bindings.push(body.description || null); }
      if (body.summary !== undefined) { updates.push('summary = ?'); bindings.push(body.summary || null); }
      if (body.pros !== undefined) { updates.push('pros = ?'); bindings.push(JSON.stringify(body.pros)); }
      if (body.cons !== undefined) { updates.push('cons = ?'); bindings.push(JSON.stringify(body.cons)); }
      if (body.faq !== undefined) { updates.push('faq = ?'); bindings.push(JSON.stringify(body.faq)); }
      if (body.images !== undefined) { updates.push('images = ?'); bindings.push(JSON.stringify(body.images)); }
      if (body.thumbnailUrl !== undefined) { updates.push('thumbnail_url = ?'); bindings.push(body.thumbnailUrl || null); }
      if (body.isPublished !== undefined) { updates.push('is_published = ?'); bindings.push(body.isPublished ? 1 : 0); }

      updates.push('updated_at = datetime(\'now\')');
      bindings.push(body.id);

      await env.DB.prepare(
        `UPDATE products SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...bindings).run();

      return successResponse({ success: true });
    } catch (err) {
      console.error('[Products] Update error:', err);
      return errorResponse('Failed to update product', 500);
    }
  }

  // DELETE - Soft delete product
  if (method === 'DELETE') {
    try {
      const body = await request.json() as { id: number };

      if (!body.id) {
        return errorResponse('Product ID required', 400);
      }

      await env.DB.prepare(
        `UPDATE products SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`
      ).bind(body.id).run();

      return successResponse({ success: true });
    } catch (err) {
      console.error('[Products] Delete error:', err);
      return errorResponse('Failed to delete product', 500);
    }
  }

  return errorResponse('Method not allowed', 405);
}

/**
 * GET /api/products/list - Product listing
 */
export async function handleProductsList(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);

  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
  const offset = (page - 1) * limit;
  const category = params.category;
  const brand = params.brand;
  const sortBy = params.sortBy || 'created_at';
  const sortOrder = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

  let whereClause = 'is_deleted = 0 AND is_published = 1';
  const bindings: (string | number)[] = [];

  if (category) {
    whereClause += ' AND category_slug = ?';
    bindings.push(category);
  }
  if (brand) {
    whereClause += ' AND brand_slug = ?';
    bindings.push(brand);
  }

  // Validate sort column
  const allowedSorts = ['created_at', 'average_rating', 'review_count', 'name'];
  const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM products WHERE ${whereClause}`
  ).bind(...bindings).first();

  const products = await env.DB.prepare(
    `SELECT * FROM products WHERE ${whereClause} ORDER BY ${safeSort} ${sortOrder} LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all();

  return successResponse({
    data: products.results || [],
    pagination: {
      page,
      limit,
      total: (countResult?.count as number) || 0,
      totalPages: Math.ceil(((countResult?.count as number) || 0) / limit),
    },
  });
}

/**
 * GET /api/products/special/deals - Deals page
 */
export async function handleProductsDeals(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);

  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
  const offset = (page - 1) * limit;

  // Get products with active deals (discount > 0)
  const products = await env.DB.prepare(
    `SELECT p.*, pp.original_price, pp.current_price, pp.discount_percent, pp.currency
     FROM products p
     JOIN platform_products pp ON pp.product_id = p.id
     WHERE p.is_deleted = 0 AND p.is_published = 1
       AND pp.is_active = 1 AND pp.discount_percent > 0
     ORDER BY pp.discount_percent DESC, p.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  const countResult = await env.DB.prepare(
    `SELECT COUNT(DISTINCT p.id) as count
     FROM products p
     JOIN platform_products pp ON pp.product_id = p.id
     WHERE p.is_deleted = 0 AND p.is_published = 1
       AND pp.is_active = 1 AND pp.discount_percent > 0`
  ).first();

  return successResponse({
    data: products.results || [],
    pagination: {
      page,
      limit,
      total: (countResult?.count as number) || 0,
      totalPages: Math.ceil(((countResult?.count as number) || 0) / limit),
    },
  });
}
