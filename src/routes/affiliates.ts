import { Elysia, t } from 'elysia';
import { db } from '../db';
import { posts, affiliateLinks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createAffiliateLink, getAllAffiliateLinks, generateToken } from '../services/affiliate/service';

export const affiliateRoutes = new Elysia({ prefix: '/api/affiliates' })

  // Create a new affiliate link
  .post('/', async ({ body }) => {
    const input = body as {
      postId: number;
      productName: string;
      destinationUrl: string;
      platform?: 'amazon' | 'other';
    };

    // Verify post exists
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, input.postId)
    });

    if (!post) {
      return new Response(JSON.stringify({ error: 'Post not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const link = await createAffiliateLink({
      postId: input.postId,
      productName: input.productName,
      destinationUrl: input.destinationUrl,
      platform: input.platform || 'amazon',
    });

    return {
      success: true,
      token: link.token,
      url: `/go/${link.token}`,
      productName: link.productName,
      destinationUrl: link.destinationUrl,
    };
  }, {
    body: t.Object({
      postId: t.Number(),
      productName: t.String(),
      destinationUrl: t.String(),
      platform: t.Optional(t.Union([
        t.Literal('amazon'),
        t.Literal('other'),
      ])),
    })
  })

  // List all affiliate links
  .get('/', async () => {
    const links = await getAllAffiliateLinks();
    return {
      success: true,
      count: links.length,
      links: links.map(link => ({
        id: link.id,
        postId: link.postId,
        token: link.token,
        url: `/go/${link.token}`,
        productName: link.productName,
        destinationUrl: link.destinationUrl,
        platform: link.platform,
        createdAt: link.createdAt,
      })),
    };
  })

  // Get affiliate link by token
  .get('/:token', async ({ params }) => {
    const link = await db.query.affiliateLinks.findFirst({
      where: eq(affiliateLinks.token, params.token)
    });

    if (!link) {
      return new Response(JSON.stringify({ error: 'Affiliate link not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return {
      token: link.token,
      url: `/go/${link.token}`,
      productName: link.productName,
      destinationUrl: link.destinationUrl,
      platform: link.platform,
    };
  });