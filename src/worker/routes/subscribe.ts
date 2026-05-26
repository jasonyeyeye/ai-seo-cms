/**
 * Subscribe API routes for Cloudflare Workers
 *
 * Endpoints:
 * - POST /api/subscribe - Subscribe email with Turnstile
 * - GET /api/subscribe - Check subscription status
 * - DELETE /api/subscribe - Unsubscribe
 * - GET /api/subscribe/confirm - Confirm email
 * - POST /api/subscribe/weekly-digest - Send weekly digest (admin)
 */

import type { Env } from '../index';
import { getQueryParams, errorResponse, successResponse, getClientIP, checkRateLimit } from '../middleware/common';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const MAILCHANNELS_API = 'https://api.mailchannels.net/tx/v1';
const TOKEN_EXPIRY_HOURS = 24;
const TURNSTILE_MIN_SCORE = 0.5;

// Rate limiting for subscription
const SUBSCRIBE_RATE_LIMIT = 5;
const SUBSCRIBE_RATE_WINDOW_MS = 60 * 1000;

interface TurnstileResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
  score?: number;
}

/**
 * Validate Turnstile token
 */
async function validateTurnstile(token: string | undefined, ip: string, env: Env): Promise<{ valid: boolean; score?: number; error?: string }> {
  const secretKey = env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    console.warn('[Subscribe] Turnstile not configured, skipping validation');
    return { valid: true };
  }

  if (!token) {
    return { valid: false, error: 'Turnstile token required' };
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
        remoteip: ip,
      }),
    });

    const result = (await response.json()) as TurnstileResponse;

    if (result.success) {
      if (result.score !== undefined && result.score < TURNSTILE_MIN_SCORE) {
        return { valid: false, score: result.score, error: `Turnstile score too low: ${result.score}` };
      }
      return { valid: true, score: result.score };
    }

    const errorCodes = result['error-codes']?.join(', ') || 'unknown';
    return { valid: false, error: `Turnstile validation failed: ${errorCodes}` };
  } catch (err) {
    console.error('[Subscribe] Turnstile validation error:', err);
    return { valid: false, error: 'Turnstile validation request failed' };
  }
}

/**
 * Check subscription rate limit
 */
async function checkSubscribeRateLimit(ip: string, env: Env): Promise<{ allowed: boolean; remaining: number }> {
  return checkRateLimit({ headers: new Headers() } as Request, env, `subscribe:${ip}`);
}

/**
 * POST /api/subscribe - Subscribe email
 */
export async function handleSubscribe(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const clientIp = getClientIP(request);

  // Rate limiting
  const rateLimit = await checkSubscribeRateLimit(clientIp, env);
  if (!rateLimit.allowed) {
    return errorResponse('Too many requests. Please try again later.', 429);
  }

  try {
    const body = await request.json() as { email?: string; turnstileToken?: string };
    const email = (body.email || '').trim().toLowerCase();

    // Validate Turnstile
    const turnstileResult = await validateTurnstile(body.turnstileToken, clientIp, env);
    if (!turnstileResult.valid) {
      return errorResponse(turnstileResult.error || 'Security validation failed', 403);
    }

    if (!email) {
      return errorResponse('Email is required', 400);
    }

    if (!EMAIL_REGEX.test(email)) {
      return errorResponse('Invalid email format', 400);
    }

    // Check if already subscribed
    const existing = await env.DB.prepare(
      'SELECT id FROM subscribers WHERE email = ?'
    ).bind(email).first();

    if (existing) {
      // Update existing subscription to active
      await env.DB.prepare(
        'UPDATE subscribers SET is_active = 1 WHERE email = ?'
      ).bind(email).run();

      return successResponse({ success: true, message: 'Subscription renewed!', isNew: false });
    }

    // Create confirmation token
    const confirmToken = crypto.randomUUID();
    const confirmExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    // Insert new subscriber
    await env.DB.prepare(
      `INSERT INTO subscribers (email, is_active, subscribed_at, confirmation_token, confirmation_expires_at, created_at)
       VALUES (?, 1, datetime('now'), ?, ?, datetime('now'))`
    ).bind(email, confirmToken, confirmExpiresAt).run();

    console.log('[Subscribe] New subscription:', email);

    // Send confirmation email via Mailchannels
    if (env.MAILCHANNELS_API_KEY) {
      const siteUrl = env.SITE_URL || 'https://ai-shopping.pages.dev';
      const confirmUrl = `${siteUrl}/api/subscribe/confirm?token=${confirmToken}`;

      try {
        await fetch(MAILCHANNELS_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.MAILCHANNELS_API_KEY}`,
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email }] }],
            from: { email: env.MAIL_FROM_EMAIL || 'noreply@ai-shopping.pages.dev', name: 'AI Shopping' },
            subject: 'Confirm your AI Shopping subscription',
            content: [{
              type: 'text/html',
              value: `
                <h1>Welcome to AI Shopping!</h1>
                <p>Thank you for subscribing. Please confirm your email by clicking the link below:</p>
                <a href="${confirmUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Confirm Subscription</a>
                <p style="margin-top:16px;color:#666;">This link will expire in ${TOKEN_EXPIRY_HOURS} hours.</p>
              `,
            }],
          }),
        });
      } catch (mailErr) {
        console.warn('[Subscribe] Welcome email failed:', mailErr);
      }
    }

    return successResponse({
      success: true,
      message: 'Subscription successful! Please check your email to confirm.',
      isNew: true,
    });
  } catch (err) {
    console.error('[Subscribe] Error:', err);
    return errorResponse('Failed to subscribe', 500);
  }
}

/**
 * GET /api/subscribe - Check subscription status
 */
export async function handleSubscribeGet(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);
  const email = (params.email || '').trim().toLowerCase();

  if (!email || !EMAIL_REGEX.test(email)) {
    return successResponse({ subscribed: false });
  }

  try {
    const result = await env.DB.prepare(
      'SELECT id, is_active FROM subscribers WHERE email = ?'
    ).bind(email).first();

    return successResponse({ subscribed: !!result && result.is_active === 1 });
  } catch {
    return successResponse({ subscribed: false });
  }
}

/**
 * DELETE /api/subscribe - Unsubscribe
 */
export async function handleSubscribeDelete(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json() as { email?: string };
    const email = (body.email || '').trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      return errorResponse('Invalid email', 400);
    }

    await env.DB.prepare(
      `UPDATE subscribers SET is_active = 0, unsubscribed_at = datetime('now') WHERE email = ?`
    ).bind(email).run();

    return successResponse({ success: true, message: 'Unsubscribed successfully' });
  } catch {
    return errorResponse('Failed to unsubscribe', 500);
  }
}

/**
 * GET /api/subscribe/confirm - Confirm email subscription
 */
export async function handleSubscribeConfirm(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const params = getQueryParams(url);
  const token = params.token;

  if (!token) {
    return errorResponse('Invalid confirmation link', 400);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, confirmation_expires_at FROM subscribers WHERE confirmation_token = ?`
    ).bind(token).first();

    if (!result) {
      return errorResponse('Invalid or expired token', 404);
    }

    // Check token expiration
    if (result.confirmation_expires_at && new Date(result.confirmation_expires_at) < new Date()) {
      return errorResponse('Confirmation link has expired. Please subscribe again.', 410);
    }

    // Confirm the subscription
    await env.DB.prepare(
      `UPDATE subscribers SET confirmed_at = datetime('now'), confirmation_token = NULL,
       confirmation_expires_at = NULL WHERE id = ?`
    ).bind(result.id).run();

    return successResponse({ success: true, message: 'Email confirmed successfully!' });
  } catch (err) {
    console.error('[Subscribe] Confirm error:', err);
    return errorResponse('Confirmation failed', 500);
  }
}

/**
 * POST /api/subscribe/weekly-digest - Send weekly digest
 */
export async function handleSubscribeWeeklyDigest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Auth is handled by middleware

  try {
    if (!env.MAILCHANNELS_API_KEY) {
      return successResponse({ success: false, error: 'Mailchannels not configured' });
    }

    // Get active subscribers
    const activeSubs = await env.DB.prepare(
      'SELECT id, email FROM subscribers WHERE is_active = 1'
    ).all();

    if (!activeSubs.results || activeSubs.results.length === 0) {
      return successResponse({ success: true, sent: 0, failed: 0, total: 0 });
    }

    const siteUrl = env.SITE_URL || 'https://ai-shopping.pages.dev';
    const dealsHtml = `
      <h1>Weekly Deals from AI Shopping</h1>
      <p>Check out this week's top deals!</p>
      <a href="${siteUrl}/deals" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">View Deals</a>
    `;

    // Send emails with concurrency control
    const BATCH_SIZE = 10;
    let sent = 0;
    let failed = 0;

    const subs = activeSubs.results as { email: string }[];
    for (let i = 0; i < subs.length; i += BATCH_SIZE) {
      const batch = subs.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(sub =>
          fetch(MAILCHANNELS_API, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.MAILCHANNELS_API_KEY}`,
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: sub.email }] }],
              from: { email: env.MAIL_FROM_EMAIL || 'noreply@ai-shopping.pages.dev', name: 'AI Shopping' },
              subject: 'Weekly Deals from AI Shopping',
              content: [{ type: 'text/html', value: dealsHtml }],
            }),
          })
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          sent++;
        } else {
          failed++;
        }
      }

      // Small delay between batches
      if (i + BATCH_SIZE < subs.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return successResponse({ success: true, sent, failed, total: subs.length });
  } catch (err) {
    console.error('[Subscribe] Weekly digest error:', err);
    return successResponse({ success: false, error: 'Failed to send digest' });
  }
}
