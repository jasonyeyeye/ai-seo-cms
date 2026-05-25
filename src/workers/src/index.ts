import { Router } from 'itty-router';
import { handlePost } from './handlers/post';
import { handleEntity } from './handlers/entity';
import { handleSitemap } from './handlers/sitemap';
import { handleSearch } from './handlers/search';
import { handleRedirect } from './handlers/redirect';

const router = Router();

// 文章页面: /posts/:slug
router.get('/posts/:slug', handlePost);

// 实体页面: /entity/:slug
router.get('/entity/:slug', handleEntity);

// 站点地图: /sitemap.xml 和 /sitemap-:index.xml
router.get('/sitemap.xml', handleSitemap);
router.get('/sitemap-:index.xml', handleSitemap);

// 搜索 API: /api/search?q=xxx
router.get('/api/search', handleSearch);

// 联盟重定向: /go/:token
router.get('/go/:token', handleRedirect);

// 首页 (从 R2 读取预生成的 index.html)
router.get('/', async (request, env) => {
  const object = await env.CONTENT_BUCKET.get('index.html');
  if (!object) return new Response('Not Found', { status: 404 });
  return new Response(object.body, {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
});

// 404
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return router.handle(request, env, ctx);
  }
};

interface Env {
  CONTENT_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  META_DB: D1Database;
  SITE_URL: string;
  ENABLE_TURNSTILE: string;
}
