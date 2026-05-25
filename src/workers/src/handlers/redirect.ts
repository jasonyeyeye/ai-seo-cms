export async function handleRedirect(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const token = url.pathname.split('/').pop()!;

  // 从 D1 获取目标 URL
  const link = await env.META_DB
    .prepare('SELECT destination_url, id FROM affiliate_links WHERE token = ?')
    .bind(token)
    .first<{ destination_url: string; id: number }>();

  if (!link) {
    return new Response('Not Found', { status: 404 });
  }

  // 异步记录点击 (不阻塞重定向)
  ctx.waitUntil(
    env.META_DB.prepare(
      'INSERT INTO affiliate_clicks (link_id, ip, user_agent, referer, clicked_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      link.id,
      request.headers.get('CF-Connecting-IP') || 'unknown',
      request.headers.get('User-Agent') || '',
      request.headers.get('Referer') || '',
      Date.now()
    ).run()
  );

  // 302 重定向
  return Response.redirect(link.destination_url, 302);
}

interface Env {
  CONTENT_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  META_DB: D1Database;
  SITE_URL: string;
  ENABLE_TURNSTILE: string;
}
