export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query parameter q' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  // 从 D1 搜索文章
  const searchPattern = `%${query}%`;
  const posts = await env.META_DB
    .prepare(`
      SELECT slug, title, quality_score as score
      FROM posts_meta
      WHERE index_status = 'index' AND (title LIKE ? OR slug LIKE ?)
      ORDER BY quality_score DESC
      LIMIT 20
    `)
    .bind(searchPattern, searchPattern)
    .all<{ slug: string; title: string; score: number }>();

  const results = posts.results.map(post => ({
    slug: post.slug,
    title: post.title,
    url: `/posts/${post.slug}`,
    score: post.score
  }));

  return new Response(JSON.stringify({ query, results }), {
    headers: { 'content-type': 'application/json' }
  });
}

interface Env {
  CONTENT_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  META_DB: D1Database;
  SITE_URL: string;
  ENABLE_TURNSTILE: string;
}
