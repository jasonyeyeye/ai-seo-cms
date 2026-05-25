import { db } from '../../db';
import { affiliateLinks, affiliateClicks } from '../../db/schema';
import { eq } from 'drizzle-orm';

export interface CreateAffiliateLinkInput {
  postId: number;
  productName: string;
  destinationUrl: string;
  platform?: 'amazon' | 'other';
}

export interface AffiliateLinkRecord {
  id: number;
  postId: number;
  token: string;
  productName: string;
  destinationUrl: string;
  platform: string;
  createdAt: Date;
}

/**
 * Generate a random 8-character token for affiliate links
 */
export function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

/**
 * Create a new affiliate link
 */
export async function createAffiliateLink(
  input: CreateAffiliateLinkInput
): Promise<AffiliateLinkRecord> {
  const token = generateToken();

  const result = await db.insert(affiliateLinks).values({
    postId: input.postId,
    token,
    productName: input.productName,
    destinationUrl: input.destinationUrl,
    platform: input.platform || 'amazon',
    createdAt: new Date(),
  }).returning();

  return result[0];
}

/**
 * Get affiliate link by token
 */
export async function getAffiliateLinkByToken(token: string): Promise<AffiliateLinkRecord | null> {
  const result = await db
    .select()
    .from(affiliateLinks)
    .where(eq(affiliateLinks.token, token))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Get all affiliate links for a post
 */
export async function getAffiliateLinksByPost(postId: number): Promise<AffiliateLinkRecord[]> {
  return db
    .select()
    .from(affiliateLinks)
    .where(eq(affiliateLinks.postId, postId));
}

/**
 * Get all affiliate links (for admin)
 */
export async function getAllAffiliateLinks(): Promise<AffiliateLinkRecord[]> {
  return db.select().from(affiliateLinks);
}

/**
 * Record an affiliate link click
 */
export async function recordAffiliateClick(
  linkId: number,
  ip: string | null,
  userAgent: string | null,
  referer: string | null
): Promise<void> {
  await db.insert(affiliateClicks).values({
    linkId,
    ip,
    userAgent,
    referer,
    clickedAt: new Date(),
  });
}

/**
 * Get click count for an affiliate link
 */
export async function getClickCount(linkId: number): Promise<number> {
  const result = await db
    .select({ count: affiliateClicks.id })
    .from(affiliateClicks)
    .where(eq(affiliateClicks.linkId, linkId));

  return result.length;
}

/**
 * Inject affiliate links into HTML content
 * Replaces product name mentions with affiliate link HTML
 */
export function injectAffiliateLinksIntoHtml(
  html: string,
  affiliateLinks: Array<{ productName: string; token: string }>
): string {
  let modifiedHtml = html;

  for (const link of affiliateLinks) {
    // Escape the product name for use in regex
    const escapedName = link.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const affiliateUrl = `/go/${link.token}`;

    // Only replace if not already an affiliate link
    const regex = new RegExp(`(?<![\\[\\(])${escapedName}(?![^\\)]*\\))`, 'gi');
    modifiedHtml = modifiedHtml.replace(
      regex,
      `<a href="${affiliateUrl}" rel="nofollow sponsored" class="affiliate-link">${link.productName}</a>`
    );
  }

  return modifiedHtml;
}