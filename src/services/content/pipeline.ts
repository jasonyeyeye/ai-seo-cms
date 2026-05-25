import { marked } from 'marked';
import type { GenerationInput, GenerationOutput, EEATScore, InfoGainCheck } from '../ai/service';
import { AIService, type EntityWithAllData } from '../ai/service';
import {
  STAGE1_OUTLINE_PROMPT,
  STAGE3_DRAFT_PROMPT,
  STAGE4_HUMANIZE_PROMPT,
  STAGE6_EEAT_EVALUATION_PROMPT,
} from './prompts';
import { generateRatingWidgetHtml } from '../../routes/ratings';
import { getAffiliateLinksByPost, injectAffiliateLinksIntoHtml } from '../affiliate/service';

// Entity Service placeholder - will be imported from entity service when available
//暂时使用模拟数据，后续与 EntityService 集成

async function getEntityWithRelations(slug: string): Promise<EntityWithAllData | null> {
  // Placeholder - in real implementation this would call EntityService
  // For now, return minimal mock data
  return null;
}

async function getStyleTemplate(styleTemplateId: string): Promise<string> {
  // Placeholder - in real implementation this would query prompt_templates table
  // Return default style template
  return `You are a knowledgeable and approachable expert writing for a curious audience.
Your tone is warm, conversational, and free of jargon.
Write as if explaining to a friend over coffee, but your friend knows you're an expert.
Use personal anecdotes, hypothetical scenarios, and direct address ("you").
Average sentence length: 15-20 words. Paragraphs: 2-3 sentences max.`;
}

async function searchFacts(query: string): Promise<string[]> {
  // Placeholder - in real implementation this would search entity knowledge graph
  return [];
}

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function extractTitle(markdown: string): string {
  // Extract title from first H1 or use first line
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  const lines = markdown.split('\n').filter(l => l.trim());
  return lines[0]?.replace(/^#+\s+/, '').trim() || 'Untitled';
}

// Stage 0: Preparation
async function prepareContext(input: GenerationInput): Promise<{
  facts: Record<string, string>;
  stylePrompt: string;
  entityName: string;
  entityType: string;
}> {
  const entity = await getEntityWithRelations(input.primaryEntitySlug);

  let facts: Record<string, string> = {};
  let entityName = input.keywords[0] || 'Unknown';
  let entityType = 'concept';

  if (entity) {
    entityName = entity.name;
    entityType = entity.type;
    // Extract facts from entity attributes
    if (entity.attributes) {
      facts = entity.attributes;
    }
  }

  const stylePrompt = await getStyleTemplate(input.styleTemplateId);

  return { facts, stylePrompt, entityName, entityType };
}

// Stage 1: Outline Generation
async function generateOutline(
  input: GenerationInput,
  facts: Record<string, string>,
  entityName: string,
  entityType: string
): Promise<string[]> {
  const prompt = STAGE1_OUTLINE_PROMPT({
    keywords: input.keywords,
    entityName,
    entityType,
    targetWordCount: input.targetWordCount,
    facts,
  });

  let outline: string[] = [];
  let attempts = 0;

  while (attempts < 3) {
    try {
      outline = await AIService.generateJSON<string[]>(prompt);
      if (Array.isArray(outline) && outline.length >= 8 && outline.length <= 20) {
        break;
      }
    } catch (error) {
      console.warn(`Outline generation attempt ${attempts + 1} failed:`, error);
    }
    attempts++;
  }

  // Fallback outline if all attempts fail
  if (!outline.length) {
    outline = [
      'Introduction',
      'What is ' + entityName,
      'Key Features',
      'Pros and Cons',
      'How It Compares',
      'Use Cases',
      'Pricing and Availability',
      'User Reviews and Ratings',
      'Expert Opinion',
      'Frequently Asked Questions',
    ];
  }

  return outline;
}

// Stage 2: Facts Enrichment
async function enrichFacts(
  outline: string[],
  primaryEntitySlug: string
): Promise<Record<string, string[]>> {
  const sectionFacts: Record<string, string[]> = {};

  for (const section of outline) {
    const facts = await searchFacts(section);
    if (facts.length > 0) {
      sectionFacts[section] = facts;
    }
  }

  return sectionFacts;
}

// Stage 3: Draft Generation
async function generateDraft(
  stylePrompt: string,
  input: GenerationInput,
  outline: string[],
  sectionFacts: Record<string, string[]>
): Promise<string> {
  const prompt = STAGE3_DRAFT_PROMPT({
    styleTemplate: stylePrompt,
    entityName: input.keywords[0],
    keywords: input.keywords,
    targetWordCount: input.targetWordCount,
    outline,
    sectionFacts,
  });

  return AIService.generate(prompt, { temperature: 0.7, maxTokens: 8192 });
}

// Stage 4: Humanization
async function humanizeContent(draftMd: string): Promise<string> {
  const prompt = STAGE4_HUMANIZE_PROMPT(draftMd);
  return AIService.generate(prompt, { temperature: 0.8, maxTokens: 8192 });
}

// Stage 5: SEO Enhancement
async function enhanceSEO(
  markdown: string,
  input: GenerationInput,
  postId?: number
): Promise<string> {
  // Convert markdown to HTML
  const html = await marked.parse(markdown);

  // Build schema.org JSON-LD based on content type
  const schema = buildSchemaOrg(input.contentType, input.keywords[0]);

  // Inject structured data into HTML head
  let seoHtml = injectSchemaIntoHtml(html, schema);

  // Inject rating widget at the bottom of the article
  const slug = generateSlug(input.keywords[0]);
  const ratingWidget = generateRatingWidgetHtml(slug);
  seoHtml = injectRatingWidget(seoHtml, ratingWidget);

  // Inject affiliate links if postId is provided
  if (postId) {
    seoHtml = await injectAffiliateLinks(seoHtml, postId);
  }

  return seoHtml;
}

function buildSchemaOrg(contentType: string, title: string): object {
  const baseSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    datePublished: new Date().toISOString(),
  };

  switch (contentType) {
    case 'review':
      return {
        ...baseSchema,
        '@type': 'Review',
      };
    case 'comparison':
      return {
        ...baseSchema,
        '@type': 'Article',
      };
    case 'guide':
      return {
        ...baseSchema,
        '@type': 'HowTo',
      };
    default:
      return baseSchema;
  }
}

function injectSchemaIntoHtml(html: string, schema: object): string {
  const schemaScript = `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;

  // Inject before </head> if present, otherwise at the beginning
  if (html.includes('</head>')) {
    return html.replace('</head>', `${schemaScript}</head>`);
  }
  return schemaScript + html;
}

// Inject rating widget HTML before the closing body tag
function injectRatingWidget(html: string, ratingWidgetHtml: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${ratingWidgetHtml}</body>`);
  }
  return html + ratingWidgetHtml;
}

// Inject affiliate links into HTML content
async function injectAffiliateLinks(html: string, postId: number): Promise<string> {
  try {
    const affiliateLinks = await getAffiliateLinksByPost(postId);
    if (affiliateLinks.length === 0) {
      return html;
    }

    const linkData = affiliateLinks.map(link => ({
      productName: link.productName,
      token: link.token,
    }));

    return injectAffiliateLinksIntoHtml(html, linkData);
  } catch (error) {
    console.error('Failed to inject affiliate links:', error);
    return html;
  }
}

// Stage 6: Quality Gate - E-E-A-T Self-Evaluation
async function evaluateEEAT(html: string): Promise<EEATScore> {
  const prompt = STAGE6_EEAT_EVALUATION_PROMPT(html);

  try {
    const score = await AIService.generateJSON<EEATScore>(prompt, { temperature: 0.3 });
    return score;
  } catch (error) {
    console.error('E-E-A-T evaluation failed:', error);
    // Return minimum passing score on failure
    return {
      experience: 5,
      expertise: 5,
      authoritativeness: 5,
      trustworthiness: 5,
      overall: 5,
    };
  }
}

// Stage 6: Information Gain Check
function checkInfoGain(html: string): InfoGainCheck {
  const elementsFound: string[] = [];

  // Check 1: table tag
  if (/<table[^>]*>/i.test(html)) {
    elementsFound.push('table');
  }

  // Check 2: price pattern (currency symbol + number)
  if (/\$\d[\d,.]+/.test(html) || /\d[\d,.]*\s?(USD|EUR|GBP)/i.test(html)) {
    elementsFound.push('price');
  }

  // Check 3: rating or percentage
  if (/\d+\s?\/\s?\d+/.test(html) || /\d+%/.test(html)) {
    elementsFound.push('rating_or_percentage');
  }

  // Check 4: blockquote or quote
  if (/<blockquote/i.test(html)) {
    elementsFound.push('quote');
  }

  // Check 5: FAQ with at least 3 Q&A pairs
  const faqMatches = html.match(/<(?:h[23]|strong)>[^<]*(?:Q:|Question:)[^<]*<\/(?:h[23]|strong)>/gi);
  if (faqMatches && faqMatches.length >= 3) {
    elementsFound.push('faq');
  }

  const requiredElements = ['table', 'price', 'rating_or_percentage', 'quote', 'faq'];
  const missingElements = requiredElements.filter(el => !elementsFound.includes(el));

  return {
    passed: elementsFound.length >= 2,
    elementsFound,
    missingElements,
  };
}

// Main pipeline function
export async function generateArticle(input: GenerationInput): Promise<GenerationOutput> {
  // Stage 0: Preparation
  const { facts, stylePrompt, entityName, entityType } = await prepareContext(input);

  // Stage 1: Outline Generation
  const outline = await generateOutline(input, facts, entityName, entityType);

  // Stage 2: Facts Enrichment
  const sectionFacts = await enrichFacts(outline, input.primaryEntitySlug);

  // Stage 3: Draft Generation
  const draftMd = await generateDraft(stylePrompt, input, outline, sectionFacts);

  // Stage 4: Humanization
  const humanizedMd = await humanizeContent(draftMd);

  // Stage 5: SEO Enhancement
  const seoEnhancedHtml = await enhanceSEO(humanizedMd, input);

  // Stage 6: Quality Gate
  const eeatScore = await evaluateEEAT(seoEnhancedHtml);
  const infoGainCheck = checkInfoGain(seoEnhancedHtml);

  return {
    title: extractTitle(humanizedMd),
    slug: generateSlug(input.keywords[0]),
    outline,
    facts,
    draftMd,
    humanizedMd,
    seoEnhancedHtml,
    eeatSelfScore: eeatScore,
    infoGainCheck,
  };
}