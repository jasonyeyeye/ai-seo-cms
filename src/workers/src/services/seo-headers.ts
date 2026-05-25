import type { PostMeta } from './d1';

export function injectSeoHeaders(
  meta: PostMeta | null,
  origin: string,
  slug: string
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Canonical URL
  headers['Link'] = `<${origin}/posts/${slug}>; rel="canonical"`;

  // 索引控制
  if (meta?.indexStatus === 'noindex') {
    headers['X-Robots-Tag'] = 'noindex, nofollow';
  } else if (meta?.lifecycleStage === 'archive') {
    headers['X-Robots-Tag'] = 'noindex, follow';
  } else {
    headers['X-Robots-Tag'] = 'index, follow';
  }

  // 缓存控制 (根据生命周期)
  const cacheControlMap: Record<string, string> = {
    'hot': 'public, max-age=3600, s-maxage=86400',
    'warm': 'public, max-age=1800, s-maxage=43200',
    'cold': 'public, max-age=600, s-maxage=7200',
    'archive': 'public, max-age=60, s-maxage=3600',
  };

  headers['Cache-Control'] = cacheControlMap[meta?.lifecycleStage || 'warm'];

  return headers;
}
