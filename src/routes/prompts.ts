import { Elysia } from 'elysia';
import { db } from '../db/index';
import { promptTemplates } from '../db/schema';
import { eq } from 'drizzle-orm';

export const promptsRouter = new Elysia()
  .get('/api/prompts', async () => {
    const templates = await db.select().from(promptTemplates);
    return templates;
  })
  .get('/api/prompts/:id', async ({ params }) => {
    const { id } = params;
    const template = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id))
      .limit(1);

    if (template.length === 0) {
      return new Response(JSON.stringify({ error: 'Template not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return template[0];
  })
  .put('/api/prompts/:id', async ({ params, body }) => {
    const { id } = params;
    const updates = body as Record<string, unknown>;

    const template = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id))
      .limit(1);

    if (template.length === 0) {
      return new Response(JSON.stringify({ error: 'Template not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.systemPrompt !== undefined) updateData.systemPrompt = updates.systemPrompt;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await db
      .update(promptTemplates)
      .set(updateData)
      .where(eq(promptTemplates.id, id));

    const updated = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id))
      .limit(1);

    return updated[0];
  });
