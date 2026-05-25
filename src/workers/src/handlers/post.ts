import { getFromR2WithCache } from '../services/r2';
import { getPostMeta } from '../services/d1';
import { injectSeoHeaders } from '../services/seo-headers';
import { injectDynamicContent } from '../utils/html-rewriter';

export async function handlePost(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.pathname.split('/').pop()!;

  // 1. 从 D1 获取文章元数据 (质量分, 生命周期阶段, 索引状态)
  const meta = await getPostMeta(env.META_DB, slug);

  // 2. 检查是否需要 noindex
  if (meta && meta.indexStatus === 'noindex') {
    return new Response('Not Found', {
      status: 404,
      headers: { 'X-Robots-Tag': 'noindex, nofollow' }
    });
  }

  // 3. 从 R2 读取 HTML (带 KV 缓存)
  let html = await getFromR2WithCache(
    env.CONTENT_BUCKET,
    env.CACHE_KV,
    `posts/${slug}/index.html`,
    meta?.lifecycleStage || 'warm',
    ctx
  );

  if (!html) {
    return new Response('Not Found', { status: 404 });
  }

  // 4. 动态注入内容 (价格、评分等实时数据)
  if (meta?.primaryEntitySlug) {
    html = await injectDynamicContent(html, env, meta.primaryEntitySlug);
  }

  // 5. 注入 SEO 头部 (X-Robots-Tag, Canonical, etc.)
  const headers = injectSeoHeaders(meta, url.origin, slug);

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

interface PostMeta {
  slug: string;
  title: string;
  primaryEntitySlug: string | null;
  qualityScore: number;
  indexStatus: string;
  lifecycleStage: string;
  updatedAt: number;
}
