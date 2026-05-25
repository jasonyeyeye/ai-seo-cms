import { db } from '../../db';
import { entities, entityAttributes, entityRelations } from '../../db/schema';
import { eq, like, or, and } from 'drizzle-orm';

export interface CreateEntityInput {
  name: string;
  slug: string;
  type: 'product' | 'brand' | 'technology' | 'person' | 'concept';
  description?: string;
  thumbnailUrl?: string;
}

export interface Entity {
  id: number;
  name: string;
  slug: string;
  type: string;
  description: string | null;
  thumbnailUrl: string | null;
  structuredData: string | null;
}

export interface EntityWithRelations extends Entity {
  attributes: Record<string, string>;
  relations: EntityRelation[];
}

export interface EntityRelation {
  id: number;
  subjectEntityId: number;
  predicate: string;
  objectEntityId: number;
  objectEntity?: Entity;
}

export interface FactSnippet {
  entitySlug: string;
  entityName: string;
  key: string;
  value: string;
}

export interface EntityDiscoveryResult {
  discovered: number;
  skipped: number;
  relationsCreated: number;
  attributesEnriched: number;
}

export interface EntityEnrichmentResult {
  entitySlug: string;
  attributesAdded: number;
  relationsAdded: number;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export const EntityService = {
  async createEntity(data: CreateEntityInput): Promise<Entity> {
    const slug = data.slug || generateSlug(data.name);

    const [created] = await db.insert(entities).values({
      name: data.name,
      slug,
      type: data.type,
      description: data.description || null,
      thumbnailUrl: data.thumbnailUrl || null,
    }).returning();

    return created;
  },

  async getEntityBySlug(slug: string): Promise<Entity | null> {
    const entity = await db.query.entities.findFirst({
      where: eq(entities.slug, slug),
    });
    return entity || null;
  },

  async getEntityWithRelations(slug: string): Promise<EntityWithRelations | null> {
    const entity = await this.getEntityBySlug(slug);
    if (!entity) return null;

    const attrs = await db.query.entityAttributes.findMany({
      where: eq(entityAttributes.entityId, entity.id),
    });

    const attrsMap: Record<string, string> = {};
    for (const attr of attrs) {
      attrsMap[attr.key] = attr.value;
    }

    const relations = await db.query.entityRelations.findMany({
      where: or(
        eq(entityRelations.subjectEntityId, entity.id),
        eq(entityRelations.objectEntityId, entity.id)
      ),
    });

    const enrichedRelations: EntityRelation[] = [];
    for (const rel of relations) {
      const objectId = rel.subjectEntityId === entity.id ? rel.objectEntityId : rel.subjectEntityId;
      const objectEntity = await this.getEntityById(objectId);
      enrichedRelations.push({
        ...rel,
        objectEntity: objectEntity || undefined,
      });
    }

    return {
      ...entity,
      attributes: attrsMap,
      relations: enrichedRelations,
    };
  },

  async getEntityById(id: number): Promise<Entity | null> {
    const entity = await db.query.entities.findFirst({
      where: eq(entities.id, id),
    });
    return entity || null;
  },

  async getAllEntities(): Promise<Entity[]> {
    return db.query.entities.findMany();
  },

  async searchEntities(query: string): Promise<Entity[]> {
    return db.query.entities.findMany({
      where: or(
        like(entities.name, `%${query}%`),
        like(entities.description, `%${query}%`)
      ),
    });
  },

  async upsertAttribute(entityId: number, key: string, value: string): Promise<void> {
    const existing = await db.query.entityAttributes.findFirst({
      where: and(eq(entityAttributes.entityId, entityId), eq(entityAttributes.key, key)),
    });

    if (existing) {
      await db.update(entityAttributes)
        .set({ value, updatedAt: new Date() })
        .where(eq(entityAttributes.id, existing.id));
    } else {
      await db.insert(entityAttributes).values({
        entityId,
        key,
        value,
        updatedAt: new Date(),
      });
    }
  },

  async getAttribute(entityId: number, key: string): Promise<string | null> {
    const attr = await db.query.entityAttributes.findFirst({
      where: and(eq(entityAttributes.entityId, entityId), eq(entityAttributes.key, key)),
    });
    return attr?.value || null;
  },

  async createRelation(subjectId: number, predicate: string, objectId: number): Promise<void> {
    const existing = await db.query.entityRelations.findFirst({
      where: and(
        eq(entityRelations.subjectEntityId, subjectId),
        eq(entityRelations.predicate, predicate),
        eq(entityRelations.objectEntityId, objectId)
      ),
    });

    if (!existing) {
      await db.insert(entityRelations).values({
        subjectEntityId: subjectId,
        predicate,
        objectEntityId: objectId,
      });
    }
  },

  async getRelations(entityId: number): Promise<EntityRelation[]> {
    const relations = await db.query.entityRelations.findMany({
      where: or(
        eq(entityRelations.subjectEntityId, entityId),
        eq(entityRelations.objectEntityId, entityId)
      ),
    });

    const enriched: EntityRelation[] = [];
    for (const rel of relations) {
      const objectId = rel.subjectEntityId === entityId ? rel.objectEntityId : rel.subjectEntityId;
      const objectEntity = await this.getEntityById(objectId);
      enriched.push({
        ...rel,
        objectEntity: objectEntity || undefined,
      });
    }

    return enriched;
  },

  async searchFacts(query: string): Promise<FactSnippet[]> {
    const results: FactSnippet[] = [];

    const matchedEntities = await db.query.entities.findMany({
      where: like(entities.name, `%${query}%`),
    });

    for (const entity of matchedEntities) {
      const attrs = await db.query.entityAttributes.findMany({
        where: eq(entityAttributes.entityId, entity.id),
      });

      for (const attr of attrs) {
        results.push({
          entitySlug: entity.slug,
          entityName: entity.name,
          key: attr.key,
          value: attr.value,
        });
      }
    }

    return results;
  },

  async discoverEntities(seedKeyword: string): Promise<EntityDiscoveryResult> {
    const { AIService } = await import('../ai/service');

    const result: EntityDiscoveryResult = {
      discovered: 0,
      skipped: 0,
      relationsCreated: 0,
      attributesEnriched: 0,
    };

    const prompt = `You are a knowledge graph builder.
Given the topic "${seedKeyword}", list the top 15 most important entities (products, brands, technologies, people) that a comprehensive article must mention.

For each entity, provide:
- name: string
- type: "product" | "brand" | "technology" | "person"
- description: 1-2 sentence summary

Respond ONLY with a JSON array: [{"name": "...", "type": "...", "description": "..."}]`;

    interface CandidateEntity {
      name: string;
      type: 'product' | 'brand' | 'technology' | 'person';
      description: string;
    }

    let candidates: CandidateEntity[];
    try {
      candidates = await AIService.generateJSON<CandidateEntity[]>(prompt);
    } catch (error) {
      console.error('[EntityService] Failed to generate candidates:', error);
      return result;
    }

    const newEntities: Entity[] = [];

    for (const candidate of candidates) {
      const existing = await db.query.entities.findFirst({
        where: eq(entities.name, candidate.name),
      });

      if (existing) {
        result.skipped++;
        newEntities.push(existing);
        continue;
      }

      const [created] = await db.insert(entities).values({
        name: candidate.name,
        slug: generateSlug(candidate.name),
        type: candidate.type,
        description: candidate.description,
      }).returning();

      newEntities.push(created);
      result.discovered++;
    }

    if (newEntities.length === 0) {
      return result;
    }

    const relationPrompt = `Given the following entities in the "${seedKeyword}" domain:
${JSON.stringify(newEntities.map(e => ({ name: e.name, type: e.type })), null, 2)}

For each entity, list its relationships to other entities in the list.
Use predicates like: "competitor_of", "manufactured_by", "compatible_with", "part_of", "successor_of", "similar_to"

Respond ONLY with JSON: [{"subject": "EntityA", "predicate": "competitor_of", "object": "EntityB"}]`;

    interface RelationResult {
      subject: string;
      predicate: string;
      object: string;
    }

    let relations: RelationResult[];
    try {
      relations = await AIService.generateJSON<RelationResult[]>(relationPrompt);
    } catch (error) {
      console.error('[EntityService] Failed to generate relations:', error);
    }

    if (relations) {
      for (const rel of relations) {
        const subjectEntity = newEntities.find(e => e.name === rel.subject);
        const objectEntity = newEntities.find(e => e.name === rel.object);

        if (subjectEntity && objectEntity) {
          await this.createRelation(subjectEntity.id, rel.predicate, objectEntity.id);
          result.relationsCreated++;
        }
      }
    }

    for (const entity of newEntities) {
      const attrResult = await this.enrichEntity(entity.slug);
      result.attributesEnriched += attrResult.attributesAdded;
    }

    return result;
  },

  async enrichEntity(entitySlug: string): Promise<EntityEnrichmentResult> {
    const { AIService } = await import('../ai/service');

    const result: EntityEnrichmentResult = {
      entitySlug,
      attributesAdded: 0,
      relationsAdded: 0,
    };

    const entity = await this.getEntityBySlug(entitySlug);
    if (!entity) return result;

    const typeMap: Record<string, string> = {
      product: 'product',
      brand: 'brand',
      technology: 'technology',
      person: 'person',
    };

    const attrPrompt = `For the entity "${entity.name}" (type: ${typeMap[entity.type] || 'entity'}), list its key factual attributes.
For a product: include price, rating, release_date, specs.
For a brand: include founded_year, headquarters, ceo, market_cap.
For a technology: include creator, release_year, version, purpose.
For a person: include title, company, notable_work.

Respond ONLY with JSON: {"attributes": [{"key": "price", "value": "$999"}, ...]}`;

    interface AttrResult {
      attributes: Array<{ key: string; value: string }>;
    }

    try {
      const attrResult = await AIService.generateJSON<AttrResult>(attrPrompt);

      if (attrResult?.attributes) {
        for (const attr of attrResult.attributes) {
          const existing = await this.getAttribute(entity.id, attr.key);
          if (!existing) {
            await this.upsertAttribute(entity.id, attr.key, attr.value);
            result.attributesAdded++;
          }
        }
      }
    } catch (error) {
      console.error(`[EntityService] Failed to enrich entity ${entitySlug}:`, error);
    }

    return result;
  },
};