// Simple Cloudflare Worker - no dependencies
const router = {
  routes: [],
  get: function(pattern, handler) {
    this.routes.push({ method: 'GET', pattern, handler });
    return this;
  },
  all: function(pattern, handler) {
    this.routes.push({ method: '*', pattern, handler });
    return this;
  },
  handle: async function(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== request.method && route.method !== '*') continue;

      const patternRegex = new RegExp('^' + route.pattern.replace(/:(\w+)/g, '([^/]+)').replace(/\*/g, '.*') + '$');
      const match = pathname.match(patternRegex);

      if (match) {
        return await route.handler(request, ...match.slice(1));
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

// Routes
router.get('/', () => {
  return new Response(JSON.stringify({
    service: 'AI SEO CMS Edge',
    version: '1.0.0',
    status: 'running',
    message: 'Worker deployed successfully'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.get('/sitemap.xml', (request, env) => {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</sitemapindex>`, {
    headers: { 'Content-Type': 'application/xml' }
  });
});

router.get('/posts/:slug', (request, env, slug) => {
  return new Response(JSON.stringify({
    slug,
    message: 'Post not found - R2 bucket not configured yet'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.get('/entity/:slug', (request, env, slug) => {
  return new Response(JSON.stringify({
    slug,
    message: 'Entity not found - D1 not populated yet'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.get('/api/search', (request) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  return new Response(JSON.stringify({ query: q, results: [] }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

router.get('/go/:token', (request, env, token) => {
  return new Response(JSON.stringify({ token, redirect: 'Affiliate link - configure R2 bucket' }), {
    status: 302,
    headers: { 'Location': 'https://example.com/affiliate/' + token }
  });
});

router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return await router.handle(request);
  }
};

interface Env {
  CONTENT_BUCKET?: R2Bucket;
  CACHE_KV: KVNamespace;
  META_DB: D1Database;
  SITE_URL: string;
  ENABLE_TURNSTILE: string;
}