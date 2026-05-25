// R2 读取封装 - 带 KV 缓存和基于生命周期的 TTL

export async function getFromR2WithCache(
  bucket: R2Bucket,
  kv: KVNamespace,
  key: string,
  lifecycleStage: string = 'warm',
  ctx: ExecutionContext
): Promise<string | null> {

  // 定义 TTL 策略 (秒)
  const ttlMap: Record<string, number> = {
    'hot': 604800,    // 7 天
    'warm': 21600,    // 6 小时
    'cold': 3600,     // 1 小时
    'archive': 86400,  // 24 小时 (但通常不缓存)
  };

  const ttl = ttlMap[lifecycleStage] || 3600;
  const cacheKey = `html:${key}`;

  // 1. 尝试从 KV 读取
  const cached = await kv.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. 从 R2 读取
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }

  const html = await object.text();

  // 3. 写入 KV 缓存
  ctx.waitUntil(kv.put(cacheKey, html, { expirationTtl: ttl }));

  return html;
}

export async function invalidateCache(
  kv: KVNamespace,
  key: string
): Promise<void> {
  const cacheKey = `html:${key}`;
  await kv.delete(cacheKey);
}
