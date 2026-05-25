import { Elysia, t } from 'elysia';
import { EntityService } from '../services/entity/service';

export const entityRoutes = new Elysia({ prefix: '/api/entities' })

  // Get all entities
  .get('/', async () => {
    const entities = await EntityService.getAllEntities();
    return { success: true, entities };
  })

  // Get entity by slug
  .get('/:slug', async ({ params }) => {
    const entity = await EntityService.getEntityBySlug(params.slug);
    if (!entity) {
      return new Response(JSON.stringify({ error: 'Entity not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return entity;
  })

  // Get entity with relations
  .get('/:slug/full', async ({ params }) => {
    const entity = await EntityService.getEntityWithRelations(params.slug);
    if (!entity) {
      return new Response(JSON.stringify({ error: 'Entity not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return entity;
  })

  // Create entity
  .post('/', async ({ body }) => {
    try {
      const entity = await EntityService.createEntity(body as any);
      return { success: true, entity };
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  })

  // Discover entities from seed keyword
  .post('/discover', async ({ body }) => {
    try {
      const { seedKeyword } = body as { seedKeyword: string };
      const result = await EntityService.discoverEntities(seedKeyword);
      return { success: true, ...result };
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }, {
    body: t.Object({
      seedKeyword: t.String(),
    })
  })

  // Enrich entity
  .post('/:slug/enrich', async ({ params }) => {
    try {
      const result = await EntityService.enrichEntity(params.slug);
      return { success: true, ...result };
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  })

  // Search entities
  .get('/search/:query', async ({ params }) => {
    const entities = await EntityService.searchEntities(params.query);
    return { success: true, entities };
  });