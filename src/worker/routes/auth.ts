/**
 * Authentication routes for Cloudflare Workers
 *
 * Endpoints:
 * - POST /api/auth/login - Login
 * - POST /api/auth/logout - Logout
 * - GET /api/auth/me - Get current user
 * - POST /api/auth/register - Register new user (admin only)
 */

import type { Env } from '../index';
import { errorResponse, successResponse, getCurrentUser, createSession, deleteSession, createSessionCookie, createLogoutCookie } from '../middleware/common';
import bcryptjs from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

/**
 * POST /api/auth/login - Login
 */
export async function handleAuthLogin(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json() as { username?: string; password?: string };
    const { username, password } = body;

    if (!username || !password) {
      return errorResponse('Username and password required', 400);
    }

    // Find user
    const user = await env.DB.prepare(
      `SELECT id, username, password_hash, role, is_active FROM users WHERE username = ? LIMIT 1`
    ).bind(username).first();

    if (!user) {
      return errorResponse('Invalid credentials', 401);
    }

    if (!user.is_active) {
      return errorResponse('Account is disabled', 401);
    }

    // Verify password using bcrypt
    const passwordValid = await bcryptjs.compare(password, user.password_hash as string);
    if (!passwordValid) {
      return errorResponse('Invalid credentials', 401);
    }

    // Create session
    const sessionId = await createSession(user.id as string, env);

    // Determine if production
    const isProduction = env.SITE_URL?.includes('https://') || false;

    return new Response(JSON.stringify({ success: true, sessionId }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': createSessionCookie(sessionId, isProduction),
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return errorResponse('Login failed', 500);
  }
}

/**
 * POST /api/auth/logout - Logout
 */
export async function handleAuthLogout(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Get session cookie
  const cookieHeader = request.headers.get('Cookie');
  let sessionId: string | null = null;

  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const cookie of cookies) {
      const [name, value] = cookie.split('=');
      if (name === 'session_id') {
        sessionId = value;
        break;
      }
    }
  }

  if (sessionId) {
    await deleteSession(sessionId, env);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': createLogoutCookie(),
    },
  });
}

/**
 * GET /api/auth/me - Get current user
 */
export async function handleAuthMe(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return errorResponse('Not authenticated', 401);
  }

  return successResponse({
    id: user.id,
    username: user.username,
    role: user.role,
  });
}

/**
 * POST /api/auth/register - Register new user (admin only)
 */
export async function handleAuthRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Auth is handled by middleware (admin only)

  try {
    const body = await request.json() as {
      username?: string;
      password?: string;
      email?: string;
      role?: string;
    };

    const { username, password, email, role } = body;

    if (!username || !password) {
      return errorResponse('Username and password required', 400);
    }

    if (username.length < 2 || username.length > 50) {
      return errorResponse('Username must be 2-50 characters', 400);
    }

    if (password.length < 6) {
      return errorResponse('Password must be at least 6 characters', 400);
    }

    // Check if username exists
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE username = ? LIMIT 1'
    ).bind(username).first();

    if (existing) {
      return errorResponse('Username already exists', 400);
    }

    // Hash password
    const passwordHash = await bcryptjs.hash(password, BCRYPT_ROUNDS);
    const userId = crypto.randomUUID();
    const userRole = ['admin', 'editor', 'reviewer', 'viewer'].includes(role || '') ? role : 'viewer';

    // Insert user
    await env.DB.prepare(
      `INSERT INTO users (id, username, password_hash, email, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
    ).bind(userId, username, passwordHash, email || null, userRole).run();

    return successResponse({ id: userId, success: true }, 201);
  } catch (err) {
    console.error('[Auth] Register error:', err);
    return errorResponse('Registration failed', 500);
  }
}
