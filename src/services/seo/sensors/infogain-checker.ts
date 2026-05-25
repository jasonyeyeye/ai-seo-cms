import { db } from '../../../db';
import { posts } from '../../../db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { writeSuggestions } from '../suggestion-writer';
import type { SensorModule, Suggestion } from './types';

interface ContentElement {
  type: 'table' | 'price' | 'rating' | 'quote' | 'faq';
  count: number;
}

function analyzeContent(contentMd: string): ContentElement[] {
  const elements: ContentElement[] = [];

  const tableRegex = /\|[\s\S]*?\|[\s\S]*?\|/g;
  const tables = contentMd.match(tableRegex);
  if (tables && tables.length > 0) {
    elements.push({ type: 'table', count: tables.length });
  }

  const priceRegex = /[\$€£¥]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
  const prices = contentMd.match(priceRegex);
  if (prices && prices.length > 0) {
    elements.push({ type: 'price', count: prices.length });
  }

  const ratingRegex = /\d+(?:\.\d+)?(?:\s*(?:stars?|rating|评分|星))/gi;
  const ratings = contentMd.match(ratingRegex);
  if (ratings && ratings.length > 0) {
    elements.push({ type: 'rating', count: ratings.length });
  }

  const quoteRegex = /[""][\s\S]{10,100}[""]/g;
  const quotes = contentMd.match(quoteRegex);
  if (quotes && quotes.length > 0) {
    elements.push({ type: 'quote', count: quotes.length });
  }

  const faqRegex = /(?:Q:|问题|FAQ)[\s\S]{5,100}(?:A:|回答|答案)[\s\S]{10,200}/gi;
  const faqs = contentMd.match(faqRegex);
  if (faqs && faqs.length >= 3) {
    elements.push({ type: 'faq', count: Math.floor(faqs.length / 2) });
  }

  return elements;
}

export const infogainChecker: SensorModule = {
  name: 'InfoGain Checker',
  source: 'infogain_checker',
  description: 'Checks articles for information gain elements (tables, prices, ratings, quotes, FAQ). Requires at least 2 elements.',
  enabled: true,
  async execute(): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    const minElements = 2;

    const recentPosts = await db
      .select({
        id: posts.id,
        slug: posts.slug,
        contentMd: posts.contentMd,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(eq(posts.status, 'published'));

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const post of recentPosts) {
      if (!post.publishedAt || post.publishedAt < oneDayAgo) continue;

      const elements = analyzeContent(post.contentMd);

      if (elements.length < minElements) {
        suggestions.push({
          type: 'info_gain_failed',
          targetType: 'post',
          targetId: post.id,
          payload: {
            reason: `Article has only ${elements.length} information elements, minimum required is ${minElements}`,
            foundElements: elements,
            missingSuggestions: getMissingSuggestions(elements),
          },
          source: 'infogain_checker',
        });
      }
    }

    await writeSuggestions(suggestions);
    return suggestions;
  },
};

function getMissingSuggestions(found: ContentElement[]): string[] {
  const allTypes = ['table', 'price', 'rating', 'quote', 'faq'] as const;
  const foundTypes = new Set(found.map((e) => e.type));
  return allTypes.filter((t) => !foundTypes.has(t));
}
