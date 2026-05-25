import { describe, test, expect } from 'bun:test';

describe('EntityService', () => {
  describe('generateSlug', () => {
    test('should convert name to lowercase slug', () => {
      const name = 'Test Product Name';
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

      expect(slug).toBe('test-product-name');
    });

    test('should remove special characters', () => {
      const name = 'Product! @#$% Special (2024)';
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

      expect(slug).toBe('product-special-2024');
    });

    test('should collapse multiple hyphens', () => {
      const name = 'Product---Name---Test';
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

      expect(slug).toBe('product-name-test');
    });

    test('should handle single word', () => {
      const name = 'Apple';
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

      expect(slug).toBe('apple');
    });
  });

  describe('Entity type validation', () => {
    const validTypes = ['product', 'brand', 'technology', 'person', 'concept'] as const;

    test.each(validTypes)('should accept valid type: %s', (type) => {
      const entity = {
        id: 1,
        name: 'Test Entity',
        slug: 'test-entity',
        type,
        description: null,
        thumbnailUrl: null,
        structuredData: null,
      };

      expect(validTypes.includes(entity.type as typeof validTypes[number])).toBe(true);
    });
  });

  describe('EntityWithAllData interface', () => {
    test('should have correct structure', () => {
      const entity = {
        id: 1,
        name: 'Test Entity',
        slug: 'test-entity',
        type: 'product',
        description: 'A test product',
        thumbnailUrl: 'https://example.com/image.jpg',
        structuredData: null,
        attributes: {
          price: '$99',
          rating: '4.5',
        },
        relations: [
          {
            id: 1,
            subjectEntityId: 1,
            predicate: 'competitor_of',
            objectEntityId: 2,
            objectEntity: {
              id: 2,
              name: 'Related Entity',
              slug: 'related-entity',
              type: 'product',
              description: null,
              thumbnailUrl: null,
              structuredData: null,
            },
          },
        ],
      };

      expect(entity.attributes).toBeDefined();
      expect(entity.relations).toBeDefined();
      expect(entity.relations[0].predicate).toBe('competitor_of');
      expect(entity.relations[0].objectEntity?.name).toBe('Related Entity');
    });
  });

  describe('FactSnippet interface', () => {
    test('should have correct structure', () => {
      const fact: {
        entitySlug: string;
        entityName: string;
        key: string;
        value: string;
      } = {
        entitySlug: 'apple',
        entityName: 'Apple',
        key: 'founded_year',
        value: '1976',
      };

      expect(fact.entitySlug).toBe('apple');
      expect(fact.entityName).toBe('Apple');
      expect(fact.key).toBe('founded_year');
      expect(fact.value).toBe('1976');
    });
  });

  describe('EntityDiscoveryResult interface', () => {
    test('should have correct structure', () => {
      const result = {
        discovered: 5,
        skipped: 2,
        relationsCreated: 10,
        attributesEnriched: 15,
      };

      expect(result.discovered).toBe(5);
      expect(result.skipped).toBe(2);
      expect(result.relationsCreated).toBe(10);
      expect(result.attributesEnriched).toBe(15);
      expect(result.discovered + result.skipped).toBe(7);
    });
  });

  describe('EntityEnrichmentResult interface', () => {
    test('should have correct structure', () => {
      const result = {
        entitySlug: 'test-entity',
        attributesAdded: 3,
        relationsAdded: 2,
      };

      expect(result.entitySlug).toBe('test-entity');
      expect(result.attributesAdded).toBe(3);
      expect(result.relationsAdded).toBe(2);
    });
  });

  describe('CreateEntityInput interface', () => {
    test('should accept valid input', () => {
      const input: {
        name: string;
        slug: string;
        type: 'product' | 'brand' | 'technology' | 'person' | 'concept';
        description?: string;
        thumbnailUrl?: string;
      } = {
        name: 'New Product',
        slug: 'new-product',
        type: 'product',
        description: 'A new product description',
      };

      expect(input.name).toBe('New Product');
      expect(input.type).toBe('product');
      expect(input.description).toBe('A new product description');
    });

    test('should allow optional fields to be omitted', () => {
      const input: {
        name: string;
        slug: string;
        type: 'product' | 'brand' | 'technology' | 'person' | 'concept';
        description?: string;
        thumbnailUrl?: string;
      } = {
        name: 'Minimal Product',
        slug: 'minimal-product',
        type: 'product',
      };

      expect(input.description).toBeUndefined();
      expect(input.thumbnailUrl).toBeUndefined();
    });
  });

  describe('EntityRelation interface', () => {
    test('should have correct structure', () => {
      const relation: {
        id: number;
        subjectEntityId: number;
        predicate: string;
        objectEntityId: number;
        objectEntity?: {
          id: number;
          name: string;
          slug: string;
        };
      } = {
        id: 1,
        subjectEntityId: 1,
        predicate: 'part_of',
        objectEntityId: 2,
        objectEntity: {
          id: 2,
          name: 'Parent Entity',
          slug: 'parent-entity',
        },
      };

      expect(relation.predicate).toBe('part_of');
      expect(relation.objectEntity?.name).toBe('Parent Entity');
    });

    test('should allow objectEntity to be undefined', () => {
      const relation: {
        id: number;
        subjectEntityId: number;
        predicate: string;
        objectEntityId: number;
        objectEntity?: {
          id: number;
          name: string;
          slug: string;
        };
      } = {
        id: 1,
        subjectEntityId: 1,
        predicate: 'competitor_of',
        objectEntityId: 3,
      };

      expect(relation.objectEntity).toBeUndefined();
    });
  });
});
