// @bun
// node_modules/itty-router/index.mjs
var t = ({ base: e = "", routes: t2 = [], ...o } = {}) => ({ __proto__: new Proxy({}, { get: (o2, r, a, s) => (o3, ...n) => t2.push([r.toUpperCase?.(), RegExp(`^${(s = (e + o3).replace(/\/+(\/|$)/g, "$1")).replace(/(\/?\.?):(\w+)\+/g, "($1(?<$2>*))").replace(/(\/?\.?):(\w+)/g, "($1(?<$2>[^$1/]+?))").replace(/\./g, "\\.").replace(/(\/?)\*/g, "($1.*)?")}/*$`), n, s]) && a }), routes: t2, ...o, async fetch(e2, ...r) {
  let a, s, n = new URL(e2.url), c = e2.query = { __proto__: null };
  for (let [e3, t3] of n.searchParams)
    c[e3] = c[e3] ? [].concat(c[e3], t3) : t3;
  e:
    try {
      for (let t3 of o.before || [])
        if ((a = await t3(e2.proxy ?? e2, ...r)) != null)
          break e;
      t:
        for (let [o2, c2, l, i] of t2)
          if ((o2 == e2.method || o2 == "ALL") && (s = n.pathname.match(c2))) {
            e2.params = s.groups || {}, e2.route = i;
            for (let t3 of l)
              if ((a = await t3(e2.proxy ?? e2, ...r)) != null)
                break t;
          }
    } catch (t3) {
      if (!o.catch)
        throw t3;
      a = await o.catch(t3, e2.proxy ?? e2, ...r);
    }
  try {
    for (let t3 of o.finally || [])
      a = await t3(a, e2.proxy ?? e2, ...r) ?? a;
  } catch (t3) {
    if (!o.catch)
      throw t3;
    a = await o.catch(t3, e2.proxy ?? e2, ...r);
  }
  return a;
} });
var o = (e = "text/plain; charset=utf-8", t2) => (o2, r = {}) => {
  if (o2 === undefined || o2 instanceof Response)
    return o2;
  const a = new Response(t2?.(o2) ?? o2, r.url ? undefined : r);
  return a.headers.set("content-type", e), a;
};
var r = o("application/json; charset=utf-8", JSON.stringify);
var p = o("text/plain; charset=utf-8", String);
var f = o("text/html");
var u = o("image/jpeg");
var h = o("image/png");
var g = o("image/webp");

// src/services/r2.ts
async function getFromR2WithCache(bucket, kv, key, lifecycleStage = "warm", ctx) {
  const ttlMap = {
    hot: 604800,
    warm: 21600,
    cold: 3600,
    archive: 86400
  };
  const ttl = ttlMap[lifecycleStage] || 3600;
  const cacheKey = `html:${key}`;
  const cached = await kv.get(cacheKey);
  if (cached) {
    return cached;
  }
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  const html = await object.text();
  ctx.waitUntil(kv.put(cacheKey, html, { expirationTtl: ttl }));
  return html;
}

// src/services/d1.ts
async function getPostMeta(d1, slug) {
  const result = await d1.prepare("SELECT * FROM posts_meta WHERE slug = ?").bind(slug).first();
  return result || null;
}
async function getEntityMeta(d1, slug) {
  const result = await d1.prepare("SELECT * FROM entity_meta WHERE slug = ?").bind(slug).first();
  return result || null;
}
async function getEntityAttributes(d1, entitySlug) {
  const result = await d1.prepare(`
      SELECT ea.key, ea.value
      FROM entity_attributes ea
      JOIN entities e ON e.id = ea.entity_id
      WHERE e.slug = ?
    `).bind(entitySlug).all();
  const attributes = {};
  for (const row of result.results) {
    attributes[row.key] = row.value;
  }
  return attributes;
}

// src/services/seo-headers.ts
function injectSeoHeaders(meta, origin, slug) {
  const headers = {};
  headers["Link"] = `<${origin}/posts/${slug}>; rel="canonical"`;
  if (meta?.indexStatus === "noindex") {
    headers["X-Robots-Tag"] = "noindex, nofollow";
  } else if (meta?.lifecycleStage === "archive") {
    headers["X-Robots-Tag"] = "noindex, follow";
  } else {
    headers["X-Robots-Tag"] = "index, follow";
  }
  const cacheControlMap = {
    hot: "public, max-age=3600, s-maxage=86400",
    warm: "public, max-age=1800, s-maxage=43200",
    cold: "public, max-age=600, s-maxage=7200",
    archive: "public, max-age=60, s-maxage=3600"
  };
  headers["Cache-Control"] = cacheControlMap[meta?.lifecycleStage || "warm"];
  return headers;
}

// src/utils/html-rewriter.ts
async function injectDynamicContent(html, env, entitySlug) {
  const attributes = await getEntityAttributes(env.META_DB, entitySlug);
  return new HTMLRewriter().on("span[data-dynamic]", {
    element(element) {
      const key = element.getAttribute("data-key");
      const fallback = element.getAttribute("data-fallback");
      const value = attributes[key] || fallback || "N/A";
      if (key === "price" && value) {
        element.setInnerContent(`$${parseFloat(value).toFixed(2)}`);
      } else {
        element.setInnerContent(value);
      }
      element.setAttribute("data-updated-at", new Date().toISOString());
    }
  }).transform(new Response(html)).text();
}

// src/handlers/post.ts
async function handlePost(request, env, ctx) {
  const url = new URL(request.url);
  const slug = url.pathname.split("/").pop();
  const meta = await getPostMeta(env.META_DB, slug);
  if (meta && meta.indexStatus === "noindex") {
    return new Response("Not Found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, nofollow" }
    });
  }
  let html = await getFromR2WithCache(env.CONTENT_BUCKET, env.CACHE_KV, `posts/${slug}/index.html`, meta?.lifecycleStage || "warm", ctx);
  if (!html) {
    return new Response("Not Found", { status: 404 });
  }
  if (meta?.primaryEntitySlug) {
    html = await injectDynamicContent(html, env, meta.primaryEntitySlug);
  }
  const headers = injectSeoHeaders(meta, url.origin, slug);
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...headers
    }
  });
}

// src/handlers/entity.ts
async function handleEntity(request, env, ctx) {
  const url = new URL(request.url);
  const slug = url.pathname.split("/").pop();
  const meta = await getEntityMeta(env.META_DB, slug);
  let html = await getFromR2WithCache(env.CONTENT_BUCKET, env.CACHE_KV, `entities/${slug}/index.html`, "warm", ctx);
  if (!html) {
    return new Response("Not Found", { status: 404 });
  }
  const headers = injectSeoHeadersForEntity(meta, url.origin, slug);
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...headers
    }
  });
}
function injectSeoHeadersForEntity(meta, origin, slug) {
  const headers = {};
  headers["Link"] = `<${origin}/entity/${slug}>; rel="canonical"`;
  headers["X-Robots-Tag"] = "index, follow";
  headers["Cache-Control"] = "public, max-age=1800, s-maxage=43200";
  return headers;
}

// src/handlers/sitemap.ts
async function handleSitemap(request, env) {
  const url = new URL(request.url);
  const indexPath = url.pathname === "/sitemap.xml";
  if (indexPath) {
    const sitemaps = await generateSitemapIndex(env);
    return new Response(sitemaps, {
      headers: { "content-type": "application/xml; charset=utf-8" }
    });
  }
  const match = url.pathname.match(/sitemap-(\d+)\.xml/);
  if (match) {
    const index = parseInt(match[1]);
    if (index === 0) {
      const xml2 = await generateEntitySitemap(env);
      return new Response(xml2, {
        headers: { "content-type": "application/xml; charset=utf-8" }
      });
    }
    const xml = await generateSitemapFragment(env, index);
    return new Response(xml, {
      headers: { "content-type": "application/xml; charset=utf-8" }
    });
  }
  return new Response("Not Found", { status: 404 });
}
async function generateSitemapIndex(env) {
  const { total } = await env.META_DB.prepare("SELECT COUNT(*) as total FROM posts_meta WHERE index_status = ?").bind("index").first();
  const postsPerSitemap = 50000;
  const sitemapCount = Math.ceil(total / postsPerSitemap);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
`;
  xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (let i = 1;i <= sitemapCount; i++) {
    xml += `  <sitemap>
`;
    xml += `    <loc>${env.SITE_URL}/sitemap-${i}.xml</loc>
`;
    xml += `    <lastmod>${new Date().toISOString()}</lastmod>
`;
    xml += `  </sitemap>
`;
  }
  xml += `  <sitemap>
`;
  xml += `    <loc>${env.SITE_URL}/sitemap-0.xml</loc>
`;
  xml += `  </sitemap>
`;
  xml += "</sitemapindex>";
  return xml;
}
async function generateSitemapFragment(env, index) {
  const postsPerSitemap = 50000;
  const offset = (index - 1) * postsPerSitemap;
  const posts = await env.META_DB.prepare("SELECT slug, updated_at, lifecycle_stage FROM posts_meta WHERE index_status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?").bind("index", postsPerSitemap, offset).all();
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (const post of posts.results) {
    const priority = post.lifecycle_stage === "hot" ? "0.9" : post.lifecycle_stage === "warm" ? "0.6" : "0.3";
    xml += `  <url>
`;
    xml += `    <loc>${env.SITE_URL}/posts/${post.slug}</loc>
`;
    xml += `    <lastmod>${new Date(post.updated_at * 1000).toISOString()}</lastmod>
`;
    xml += `    <changefreq>${post.lifecycle_stage === "hot" ? "daily" : "weekly"}</changefreq>
`;
    xml += `    <priority>${priority}</priority>
`;
    xml += `  </url>
`;
  }
  xml += "</urlset>";
  return xml;
}
async function generateEntitySitemap(env) {
  const entities = await env.META_DB.prepare("SELECT slug, updated_at FROM entity_meta ORDER BY updated_at DESC").all();
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (const entity of entities.results) {
    xml += `  <url>
`;
    xml += `    <loc>${env.SITE_URL}/entity/${entity.slug}</loc>
`;
    xml += `    <lastmod>${new Date(entity.updated_at * 1000).toISOString()}</lastmod>
`;
    xml += `    <changefreq>weekly</changefreq>
`;
    xml += `    <priority>0.7</priority>
`;
    xml += `  </url>
`;
  }
  xml += "</urlset>";
  return xml;
}

// src/handlers/search.ts
async function handleSearch(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query parameter q" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }
  const searchPattern = `%${query}%`;
  const posts = await env.META_DB.prepare(`
      SELECT slug, title, quality_score as score
      FROM posts_meta
      WHERE index_status = 'index' AND (title LIKE ? OR slug LIKE ?)
      ORDER BY quality_score DESC
      LIMIT 20
    `).bind(searchPattern, searchPattern).all();
  const results = posts.results.map((post) => ({
    slug: post.slug,
    title: post.title,
    url: `/posts/${post.slug}`,
    score: post.score
  }));
  return new Response(JSON.stringify({ query, results }), {
    headers: { "content-type": "application/json" }
  });
}

// src/handlers/redirect.ts
async function handleRedirect(request, env, ctx) {
  const url = new URL(request.url);
  const token = url.pathname.split("/").pop();
  const link = await env.META_DB.prepare("SELECT destination_url, id FROM affiliate_links WHERE token = ?").bind(token).first();
  if (!link) {
    return new Response("Not Found", { status: 404 });
  }
  ctx.waitUntil(env.META_DB.prepare("INSERT INTO affiliate_clicks (link_id, ip, user_agent, referer, clicked_at) VALUES (?, ?, ?, ?, ?)").bind(link.id, request.headers.get("CF-Connecting-IP") || "unknown", request.headers.get("User-Agent") || "", request.headers.get("Referer") || "", Date.now()).run());
  return Response.redirect(link.destination_url, 302);
}

// src/index.ts
var router = t();
router.get("/posts/:slug", handlePost);
router.get("/entity/:slug", handleEntity);
router.get("/sitemap.xml", handleSitemap);
router.get("/sitemap-:index.xml", handleSitemap);
router.get("/api/search", handleSearch);
router.get("/go/:token", handleRedirect);
router.get("/", async (request, env) => {
  const object = await env.CONTENT_BUCKET.get("index.html");
  if (!object)
    return new Response("Not Found", { status: 404 });
  return new Response(object.body, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
});
router.all("*", () => new Response("Not Found", { status: 404 }));
var src_default = {
  async fetch(request, env, ctx) {
    return router.handle(request, env, ctx);
  }
};
export {
  src_default as default
};
