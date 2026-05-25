import { getEntityAttributes } from '../services/d1';

export async function injectDynamicContent(
  html: string,
  env: Env,
  entitySlug: string
): Promise<string> {
  // 1. 从 D1 或 KV 获取实体的实时属性
  const attributes = await getEntityAttributes(env.META_DB, entitySlug);

  // 2. 使用 HTMLRewriter 进行替换
  return new HTMLRewriter()
    .on('span[data-dynamic]', {
      element(element) {
        const key = element.getAttribute('data-key');
        const fallback = element.getAttribute('data-fallback');
        const value = attributes[key] || fallback || 'N/A';

        // 特殊处理价格格式
        if (key === 'price' && value) {
          element.setInnerContent(`$${parseFloat(value).toFixed(2)}`);
        } else {
          element.setInnerContent(value);
        }

        // 添加更新时间戳
        element.setAttribute('data-updated-at', new Date().toISOString());
      }
    })
    .transform(new Response(html))
    .text();
}

interface Env {
  CONTENT_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  META_DB: D1Database;
  SITE_URL: string;
  ENABLE_TURNSTILE: string;
}
