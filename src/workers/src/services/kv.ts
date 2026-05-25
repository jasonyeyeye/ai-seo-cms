// KV 缓存操作封装

export async function getCachedValue(kv: KVNamespace, key: string): Promise<string | null> {
  return kv.get(key);
}

export async function setCacheValue(
  kv: KVNamespace,
  key: string,
  value: string,
  ttl?: number
): Promise<void> {
  if (ttl) {
    await kv.put(key, value, { expirationTtl: ttl });
  } else {
    await kv.put(key, value);
  }
}

export async function deleteCacheValue(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}

export async function getJsonFromCache<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const value = await kv.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function setJsonCache<T>(
  kv: KVNamespace,
  key: string,
  value: T,
  ttl?: number
): Promise<void> {
  const json = JSON.stringify(value);
  await setCacheValue(kv, key, json, ttl);
}
