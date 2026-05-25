import type { PostMeta } from '../services/d1';

export function enhanceStructuredData(
  originalHtml: string,
  meta: PostMeta,
  avgRating: number | null,
  ratingCount: number | null
): string {
  // 如果没有实时评分数据，直接返回原始 HTML
  if (!avgRating) return originalHtml;

  // 构建 AggregateRating Schema
  const ratingSchema = {
    "@type": "AggregateRating",
    "ratingValue": avgRating.toFixed(1),
    "reviewCount": ratingCount || 0,
    "bestRating": "5",
    "worstRating": "1"
  };

  // 使用简单的字符串替换，在 </head> 前注入
  const scriptTag = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": meta.title,
    "aggregateRating": ratingSchema,
    "datePublished": new Date(meta.updatedAt * 1000).toISOString(),
  })}</script>`;

  return originalHtml.replace('</head>', `${scriptTag}\n</head>`);
}

export function createArticleStructuredData(
  title: string,
  slug: string,
  publishedAt: number
): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": title,
    "url": `/posts/${slug}`,
    "datePublished": new Date(publishedAt * 1000).toISOString(),
    "dateModified": new Date(publishedAt * 1000).toISOString(),
  });
}

export function createProductStructuredData(
  name: string,
  slug: string,
  attributes: Record<string, string>
): string {
  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": name,
    "url": `/entity/${slug}`,
  };

  // Add attributes as properties
  if (attributes.price) {
    product["offers"] = {
      "@type": "Offer",
      "price": attributes.price,
      "priceCurrency": "USD"
    };
  }

  if (attributes.rating) {
    product["aggregateRating"] = {
      "@type": "AggregateRating",
      "ratingValue": attributes.rating,
      "bestRating": "5",
      "worstRating": "1"
    };
  }

  return JSON.stringify(product);
}
