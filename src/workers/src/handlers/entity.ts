import { getFromR2WithCache } from '../services/r2';
import { getEntityMeta } from '../services/d1';
import { injectSeoHeaders } from '../services/seo-headers';

export async function handleEntity(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.pathname.split('/').pop()!;

  // 1. 从 D1 获取实体元数据
  const meta = await getEntityMeta(env.META_DB, slug);

  // 2. 从 R2 读取 HTML (带 KV 缓存)
  let html = await getFromR2WithCache(
    env.CONTENT_BUCKET,
    env.CACHE_KV,
    `entities/${slug}/index.html`,
    'warm',
    ctx
  );

  if (!html) {
    return new Response('Not Found', { status: 404 });
  }

  // 3. 注入 SEO 头部
  const headers = injectSeoHeadersForEntity(meta, url.origin, slug);

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...headers
    }
  });
}

interface Env {
  CONTENT_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  META_DB: D1Database;
  SITE_URL: string;
  ENABLE_TURNSTILE: string;
}

interface EntityMeta {
  slug: string;
  name: string;
  type: string;
  hasStructuredData: boolean;
  updatedAt: number;
}

function injectSeoHeadersForEntity(
  meta: EntityMeta | null,
  origin: string,
  slug: string
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Canonical URL
  headers['Link'] = `<${origin}/entity/${slug}>; rel="canonical"`;

  // Default indexing
  headers['X-Robots-Tag'] = 'index, follow';

  // Cache control
  headers['Cache-Control'] = 'public, max-age=1800, s-maxage=43200';

  return headers;
}
