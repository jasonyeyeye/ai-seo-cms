export async function handleSitemap(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const indexPath = url.pathname === '/sitemap.xml';

  if (indexPath) {
    const sitemaps = await generateSitemapIndex(env);
    return new Response(sitemaps, {
      headers: { 'content-type': 'application/xml; charset=utf-8' }
    });
  }

  // 分片 sitemap: /sitemap-1.xml, /sitemap-2.xml, ...
  const match = url.pathname.match(/sitemap-(\d+)\.xml/);
  if (match) {
    const index = parseInt(match[1]);
    if (index === 0) {
      // sitemap-entities.xml
      const xml = await generateEntitySitemap(env);
      return new Response(xml, {
        headers: { 'content-type': 'application/xml; charset=utf-8' }
      });
    }
    const xml = await generateSitemapFragment(env, index);
    return new Response(xml, {
      headers: { 'content-type': 'application/xml; charset=utf-8' }
    });
  }

  return new Response('Not Found', { status: 404 });
}

async function generateSitemapIndex(env: Env): Promise<string> {
  // 从 D1 获取总文章数
  const { total } = await env.META_DB
    .prepare('SELECT COUNT(*) as total FROM posts_meta WHERE index_status = ?')
    .bind('index')
    .first<{ total: number }>();

  const postsPerSitemap = 50000;
  const sitemapCount = Math.ceil(total / postsPerSitemap);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // 添加文章 sitemap 分片
  for (let i = 1; i <= sitemapCount; i++) {
    xml += `  <sitemap>\n`;
    xml += `    <loc>${env.SITE_URL}/sitemap-${i}.xml</loc>\n`;
    xml += `    <lastmod>${new Date().toISOString()}</lastmod>\n`;
    xml += `  </sitemap>\n`;
  }

  // 添加实体 sitemap
  xml += `  <sitemap>\n`;
  xml += `    <loc>${env.SITE_URL}/sitemap-0.xml</loc>\n`;
  xml += `  </sitemap>\n`;

  xml += '</sitemapindex>';
  return xml;
}

async function generateSitemapFragment(env: Env, index: number): Promise<string> {
  const postsPerSitemap = 50000;
  const offset = (index - 1) * postsPerSitemap;

  const posts = await env.META_DB
    .prepare('SELECT slug, updated_at, lifecycle_stage FROM posts_meta WHERE index_status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .bind('index', postsPerSitemap, offset)
    .all<{ slug: string; updated_at: number; lifecycle_stage: string }>();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const post of posts.results) {
    const priority = post.lifecycle_stage === 'hot' ? '0.9' :
      post.lifecycle_stage === 'warm' ? '0.6' : '0.3';
    xml += `  <url>\n`;
    xml += `    <loc>${env.SITE_URL}/posts/${post.slug}</loc>\n`;
    xml += `    <lastmod>${new Date(post.updated_at * 1000).toISOString()}</lastmod>\n`;
    xml += `    <changefreq>${post.lifecycle_stage === 'hot' ? 'daily' : 'weekly'}</changefreq>\n`;
    xml += `    <priority>${priority}</priority>\n`;
    xml += `  </url>\n`;
  }

  xml += '</urlset>';
  return xml;
}

async function generateEntitySitemap(env: Env): Promise<string> {
  const entities = await env.META_DB
    .prepare('SELECT slug, updated_at FROM entity_meta ORDER BY updated_at DESC')
    .all<{ slug: string; updated_at: number }>();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const entity of entities.results) {
    xml += `  <url>\n`;
    xml += `    <loc>${env.SITE_URL}/entity/${entity.slug}</loc>\n`;
    xml += `    <lastmod>${new Date(entity.updated_at * 1000).toISOString()}</lastmod>\n`;
    xml += `    <changefreq>weekly</changefreq>\n`;
    xml += `    <priority>0.7</priority>\n`;
    xml += `  </url>\n`;
  }

  xml += '</urlset>';
  return xml;
}

interface Env {
  CONTENT_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  META_DB: D1Database;
  SITE_URL: string;
  ENABLE_TURNSTILE: string;
}
