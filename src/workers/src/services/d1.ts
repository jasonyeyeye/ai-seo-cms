// D1 数据库查询封装

export interface PostMeta {
  slug: string;
  title: string;
  primaryEntitySlug: string | null;
  qualityScore: number;
  indexStatus: string;
  lifecycleStage: string;
  updatedAt: number;
}

export interface EntityMeta {
  slug: string;
  name: string;
  type: string;
  hasStructuredData: boolean;
  updatedAt: number;
}

export async function getPostMeta(d1: D1Database, slug: string): Promise<PostMeta | null> {
  const result = await d1
    .prepare('SELECT * FROM posts_meta WHERE slug = ?')
    .bind(slug)
    .first<PostMeta>();

  return result || null;
}

export async function getEntityMeta(d1: D1Database, slug: string): Promise<EntityMeta | null> {
  const result = await d1
    .prepare('SELECT * FROM entity_meta WHERE slug = ?')
    .bind(slug)
    .first<EntityMeta>();

  return result || null;
}

export async function getEntityAttributes(
  d1: D1Database,
  entitySlug: string
): Promise<Record<string, string>> {
  const result = await d1
    .prepare(`
      SELECT ea.key, ea.value
      FROM entity_attributes ea
      JOIN entities e ON e.id = ea.entity_id
      WHERE e.slug = ?
    `)
    .bind(entitySlug)
    .all<{ key: string; value: string }>();

  const attributes: Record<string, string> = {};
  for (const row of result.results) {
    attributes[row.key] = row.value;
  }
  return attributes;
}
