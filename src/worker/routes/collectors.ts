/**
 * Collector routes for Cloudflare Workers
 *
 * Endpoints:
 * - GET /api/collectors/status - Get adapter status
 * - GET /api/collectors/jobs - Get recent jobs
 * - POST /api/collectors/trigger - Trigger collection (admin)
 * - GET/POST/DELETE /api/collectors/schedules - Manage schedules
 */

import type { Env } from '../index';
import { getQueryParams, errorResponse, successResponse } from '../middleware/common';

/**
 * GET /api/collectors/status - Get all registered adapters status
 */
export async function handleCollectorsStatus(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const adapters = await env.DB.prepare(
      `SELECT platform, adapter_type, is_enabled, last_fetch_at, last_success_at, last_error, created_at
       FROM platform_adapters ORDER BY platform`
    ).all();

    return successResponse({
      registered: (adapters.results || []).map((a: Record<string, unknown>) => a.platform),
      adapters: adapters.results || [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Collectors] Status error:', err);
    return successResponse({ registered: [], adapters: [], timestamp: new Date().toISOString() });
  }
}

/**
 * GET /api/collectors/jobs - Get recent collection jobs
 */
export async function handleCollectorsJobs(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 50));

  try {
    const jobs = await env.DB.prepare(
      `SELECT id, adapter_name, status, items_collected, items_failed, error, started_at, completed_at, created_at
       FROM collection_jobs
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(limit).all();

    return successResponse({
      jobs: jobs.results || [],
      count: (jobs.results || []).length,
    });
  } catch (err) {
    console.error('[Collectors] Jobs error:', err);
    return successResponse({ jobs: [], count: 0 });
  }
}

/**
 * POST /api/collectors/trigger - Trigger manual collection
 */
export async function handleCollectorsTrigger(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Auth is handled by middleware (admin only)

  try {
    const body = await request.json() as { adapter?: string; limit?: number };
    const { adapter, limit } = body;

    if (!adapter) {
      return errorResponse('Adapter name required', 400);
    }

    // Check if adapter exists
    const adapterRecord = await env.DB.prepare(
      'SELECT platform FROM platform_adapters WHERE platform = ? AND is_enabled = 1 LIMIT 1'
    ).bind(adapter).first();

    if (!adapterRecord) {
      return errorResponse(`Adapter "${adapter}" not found or disabled`, 404);
    }

    // Create a collection job
    const jobId = crypto.randomUUID();
    const itemLimit = limit || 100;

    await env.DB.prepare(
      `INSERT INTO collection_jobs (id, adapter_name, status, items_collected, items_failed, created_at)
       VALUES (?, ?, 'running', 0, 0, datetime('now'))`
    ).bind(jobId, adapter).run();

    // Note: Actual collection would be handled by a separate worker/queue
    // For now, just return the job ID
    return successResponse({
      success: true,
      jobId,
      message: `Collection job started for ${adapter}`,
    });
  } catch (err) {
    console.error('[Collectors] Trigger error:', err);
    return errorResponse('Collection failed', 500);
  }
}

/**
 * GET/POST/DELETE /api/collectors/schedules - Manage schedules
 */
export async function handleCollectorsSchedules(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);
  const method = request.method;

  // GET - List schedules
  if (method === 'GET') {
    try {
      const schedules = await env.DB.prepare(
        `SELECT id, adapter_name, cron_expression, enabled, item_limit, created_at, updated_at
         FROM collection_schedules ORDER BY adapter_name`
      ).all();

      return successResponse({
        schedules: schedules.results || [],
        count: (schedules.results || []).length,
      });
    } catch (err) {
      console.error('[Collectors] Schedules error:', err);
      return successResponse({ schedules: [], count: 0 });
    }
  }

  // POST - Create/update schedule
  if (method === 'POST') {
    try {
      const body = await request.json() as {
        adapter: string;
        cronExpression: string;
        enabled?: boolean;
        itemLimit?: number;
      };

      if (!body.adapter || !body.cronExpression) {
        return errorResponse('Adapter and cronExpression required', 400);
      }

      const scheduleId = crypto.randomUUID();
      const enabled = body.enabled !== false ? 1 : 0;

      // Check if schedule exists
      const existing = await env.DB.prepare(
        'SELECT id FROM collection_schedules WHERE adapter_name = ? LIMIT 1'
      ).bind(body.adapter).first();

      if (existing) {
        // Update
        await env.DB.prepare(
          `UPDATE collection_schedules SET cron_expression = ?, enabled = ?, item_limit = ?, updated_at = datetime('now')
           WHERE adapter_name = ?`
        ).bind(body.cronExpression, enabled, body.itemLimit || null, body.adapter).run();

        return successResponse({ success: true, message: `Schedule updated for ${body.adapter}` });
      } else {
        // Insert
        await env.DB.prepare(
          `INSERT INTO collection_schedules (id, adapter_name, cron_expression, enabled, item_limit, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).bind(scheduleId, body.adapter, body.cronExpression, enabled, body.itemLimit || null).run();

        return successResponse({ success: true, message: `Schedule created for ${body.adapter}` });
      }
    } catch (err) {
      console.error('[Collectors] Schedule create error:', err);
      return errorResponse('Failed to create schedule', 500);
    }
  }

  // DELETE - Delete schedule
  if (method === 'DELETE') {
    const adapter = params.adapter || url.pathname.split('/').pop();

    if (!adapter) {
      return errorResponse('Adapter name required', 400);
    }

    try {
      await env.DB.prepare('DELETE FROM collection_schedules WHERE adapter_name = ?').bind(adapter).run();
      return successResponse({ success: true, message: `Schedule deleted for ${adapter}` });
    } catch (err) {
      console.error('[Collectors] Schedule delete error:', err);
      return errorResponse('Failed to delete schedule', 500);
    }
  }

  return errorResponse('Method not allowed', 405);
}
