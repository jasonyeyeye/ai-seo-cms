/**
 * Cloudflare Worker Entry Point
 *
 * This Worker handles:
 * - /api/search - Search with KV caching
 * - /api/subscribe - Email subscription with Turnstile
 * - /api/analytics - Event collection to D1
 * - /api/go/:token - Affiliate redirects with click logging
 * - /api/auth/* - Authentication (login/logout/register)
 * - /api/products/* - Product CRUD via D1
 * - /api/collectors/* - Collection triggers (admin auth)
 * - /api/admin/* - Admin dashboard endpoints
 *
 * Key constraints:
 * - NO eval() or code generation from strings
 * - NO global scope async I/O at startup (lazy initialization)
 * - NO native modules (bcryptjs is Workers-compatible)
 * - D1 access via direct SQL queries
 */

import { handleSearch, handleSearchAutocomplete, handleSearchHot, handleSearchLog } from './routes/search';
import { handleSubscribe, handleSubscribeGet, handleSubscribeDelete, handleSubscribeConfirm, handleSubscribeWeeklyDigest } from './routes/subscribe';
import { handleAnalytics, handleAnalyticsEvents } from './routes/analytics';
import { handleAffiliateRedirect } from './routes/affiliate';
import { handleAuthLogin, handleAuthLogout, handleAuthMe, handleAuthRegister } from './routes/auth';
import { handleProductsCrud, handleProductsList, handleProductsDeals } from './routes/products';
import { handleCollectorsStatus, handleCollectorsJobs, handleCollectorsTrigger, handleCollectorsSchedules } from './routes/collectors';
import { handleAdminDashboard } from './routes/admin';
import { withCors, withAuth, withAdminAuth, errorResponse } from './middleware/common';

// Environment bindings interface
interface Env {
  // D1 Database
  DB: D1Database;
  // KV Namespaces
  CACHE_KV: KVNamespace;
  SEARCH_CACHE: KVNamespace;
  PRODUCT_CACHE: KVNamespace;
  // R2 Buckets
  CONTENT_BUCKET: R2Bucket;
  // Site configuration
  SITE_URL: string;
  SITE_TITLE: string;
  // Turnstile
  TURNSTILE_SECRET_KEY: string;
  // Mailchannels
  MAILCHANNELS_API_KEY: string;
  MAIL_FROM_EMAIL: string;
  // Auth
  ADMIN_TOKEN: string;
  BCRYPT_ROUNDS: string;
  // Rate limiting
  RATE_LIMIT_KV: KVNamespace;
}

// Route handler type
type RouteHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

// Route definition
interface Route {
  pattern: URLPattern;
  handler: RouteHandler;
  methods: string[];
  auth?: 'admin' | 'user';
}

// Simple router implementation (no eval)
function createRouter(routes: Route[]) {
  return async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    for (const route of routes) {
      if (!route.methods.includes(method) && !route.methods.includes('*')) {
        continue;
      }

      const match = route.pattern.exec(url);
      if (match) {
        // Apply auth middleware if needed
        if (route.auth === 'admin') {
          const adminAuthResponse = await withAdminAuth(request, env);
          if (adminAuthResponse) return withCors(adminAuthResponse);
        } else if (route.auth === 'user') {
          const userAuthResponse = await withAuth(request, env);
          if (userAuthResponse) return withCors(userAuthResponse);
        }

        // Wrap with CORS and call handler
        const response = await route.handler(request, env, ctx);
        return withCors(response);
      }
    }

    // No route matched
    return withCors(errorResponse('Not Found', 404));
  };
}

// Define routes
const routes: Route[] = [
  // Search endpoints (GET only, no auth)
  {
    pattern: new URLPattern({ pathname: '/api/search' }),
    handler: handleSearch,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/search/autocomplete' }),
    handler: handleSearchAutocomplete,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/search/hot' }),
    handler: handleSearchHot,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/search/log' }),
    handler: handleSearchLog,
    methods: ['POST'],
  },

  // Subscribe endpoints
  {
    pattern: new URLPattern({ pathname: '/api/subscribe' }),
    handler: handleSubscribe,
    methods: ['POST'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/subscribe' }),
    handler: handleSubscribeGet,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/subscribe' }),
    handler: handleSubscribeDelete,
    methods: ['DELETE'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/subscribe/confirm' }),
    handler: handleSubscribeConfirm,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/subscribe/weekly-digest' }),
    handler: handleSubscribeWeeklyDigest,
    methods: ['POST'],
    auth: 'admin',
  },

  // Analytics endpoints
  {
    pattern: new URLPattern({ pathname: '/api/analytics' }),
    handler: handleAnalytics,
    methods: ['POST'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/analytics/events' }),
    handler: handleAnalyticsEvents,
    methods: ['GET'],
  },

  // Affiliate redirect
  {
    pattern: new URLPattern({ pathname: '/go/:token' }),
    handler: handleAffiliateRedirect,
    methods: ['GET'],
  },

  // Auth endpoints
  {
    pattern: new URLPattern({ pathname: '/api/auth/login' }),
    handler: handleAuthLogin,
    methods: ['POST'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/auth/logout' }),
    handler: handleAuthLogout,
    methods: ['POST'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/auth/me' }),
    handler: handleAuthMe,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/auth/register' }),
    handler: handleAuthRegister,
    methods: ['POST'],
    auth: 'admin',
  },

  // Product endpoints
  {
    pattern: new URLPattern({ pathname: '/api/products/crud' }),
    handler: handleProductsCrud,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/products/list' }),
    handler: handleProductsList,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/products/special/deals' }),
    handler: handleProductsDeals,
    methods: ['GET'],
  },

  // Collector endpoints
  {
    pattern: new URLPattern({ pathname: '/api/collectors/status' }),
    handler: handleCollectorsStatus,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/collectors/jobs' }),
    handler: handleCollectorsJobs,
    methods: ['GET'],
  },
  {
    pattern: new URLPattern({ pathname: '/api/collectors/trigger' }),
    handler: handleCollectorsTrigger,
    methods: ['POST'],
    auth: 'admin',
  },
  {
    pattern: new URLPattern({ pathname: '/api/collectors/schedules' }),
    handler: handleCollectorsSchedules,
    methods: ['GET', 'POST', 'DELETE'],
  },

  // Admin endpoints
  {
    pattern: new URLPattern({ pathname: '/api/admin/dashboard' }),
    handler: handleAdminDashboard,
    methods: ['GET'],
    auth: 'admin',
  },
];

const router = createRouter(routes);

// Worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // Route the request
      const response = await router(request, env, ctx);
      return response;
    } catch (err) {
      console.error('[Worker] Unhandled error:', err);
      return withCors(errorResponse('Internal Server Error', 500));
    }
  },
};
