/**
 * Common middleware utilities for Cloudflare Workers
 *
 * Includes:
 * - CORS handling
 * - Authentication helpers
 * - Rate limiting
 * - Error responses
 * - Session management
 */

import type { Env } from '../index';

// Session cookie name
const SESSION_COOKIE = 'session_id';
const SESSION_COOKIE_OPTIONS = 'HttpOnly; SameSite=Lax; Path=/';

// Rate limiting configuration
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Add CORS headers to a response
 */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create a JSON error response
 */
export function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create a JSON success response
 */
export function successResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Get session ID from cookie header
 */
function getSessionId(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === SESSION_COOKIE) {
      return value;
    }
  }
  return null;
}

/**
 * Check if user is authenticated (session-based)
 */
export async function withAuth(request: Request, env: Env): Promise<Response | null> {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return errorResponse('Unauthorized', 401);
  }

  // Verify session exists and is not expired
  const result = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.is_active
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1
     LIMIT 1`
  ).bind(sessionId).first();

  if (!result) {
    return errorResponse('Invalid or expired session', 401);
  }

  return null; // Auth passed
}

/**
 * Check if user is authenticated and is an admin
 */
export async function withAdminAuth(request: Request, env: Env): Promise<Response | null> {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    // Also check Bearer token for API access
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token === env.ADMIN_TOKEN) {
        return null; // Admin token auth passed
      }
    }
    return errorResponse('Unauthorized', 401);
  }

  // Verify session exists, is not expired, and user is admin
  const result = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.is_active
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1 AND u.role = 'admin'
     LIMIT 1`
  ).bind(sessionId).first();

  if (!result) {
    return errorResponse('Admin access required', 403);
  }

  return null; // Auth passed
}

/**
 * Get current user from session (returns null if not authenticated)
 */
export async function getCurrentUser(request: Request, env: Env): Promise<{ id: string; username: string; role: string } | null> {
  const sessionId = getSessionId(request);
  if (!sessionId) return null;

  const result = await env.DB.prepare(
    `SELECT u.id, u.username, u.role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1
     LIMIT 1`
  ).bind(sessionId).first();

  if (!result) return null;

  return {
    id: result.id as string,
    username: result.username as string,
    role: result.role as string,
  };
}

/**
 * Rate limiting check using KV
 */
export async function checkRateLimit(request: Request, env: Env, key: string): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  try {
    // Get current count
    const record = await env.RATE_LIMIT_KV.get(`ratelimit:${key}`);
    let count = 0;
    let resetAt = now + RATE_LIMIT_WINDOW_MS;

    if (record) {
      const parsed = JSON.parse(record);
      if (parsed.resetAt > now) {
        count = parsed.count;
        resetAt = parsed.resetAt;
      }
    }

    if (count >= RATE_LIMIT_MAX) {
      return { allowed: false, remaining: 0 };
    }

    // Increment counter
    count++;
    await env.RATE_LIMIT_KV.put(`ratelimit:${key}`, JSON.stringify({ count, resetAt }), {
      expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 1,
    });

    return { allowed: true, remaining: RATE_LIMIT_MAX - count };
  } catch {
    // If KV fails, allow the request
    return { allowed: true, remaining: RATE_LIMIT_MAX };
  }
}

/**
 * Parse JSON body from request
 */
export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Get client IP from request headers
 */
export function getClientIP(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Parse query parameters from URL
 */
export function getQueryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Create session and set cookie
 */
export async function createSession(userId: string, env: Env): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await env.DB.prepare(
    `INSERT INTO user_sessions (id, user_id, expires_at, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(sessionId, userId, expiresAt.toISOString()).run();

  return sessionId;
}

/**
 * Delete session
 */
export async function deleteSession(sessionId: string, env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM user_sessions WHERE id = ?').bind(sessionId).run();
}

/**
 * Create session cookie header
 */
export function createSessionCookie(sessionId: string, isProduction: boolean): string {
  const secure = isProduction ? '; Secure' : '';
  return `${SESSION_COOKIE}=${sessionId}; ${SESSION_COOKIE_OPTIONS}${secure}; Max-Age=86400`;
}

/**
 * Create logout cookie header
 */
export function createLogoutCookie(): string {
  return `${SESSION_COOKIE}=; ${SESSION_COOKIE_OPTIONS}; Max-Age=0`;
}
