import type { GenerationInput, EEATScore } from '../ai/service';

export const STAGE0_SYSTEM_PROMPT = `You are an expert SEO content strategist and entity knowledge graph builder.
Your role is to extract and organize factual information about entities for article writing.`;

export const STAGE1_OUTLINE_PROMPT = (input: {
  keywords: string[];
  entityName: string;
  entityType: string;
  targetWordCount: number;
  facts: Record<string, string>;
}): string => `You are an expert SEO content strategist.
Generate a detailed article outline for the following keywords: ${input.keywords.join(', ')}
The article is about this primary entity: ${input.entityName} (${input.entityType})
Target word count: ${input.targetWordCount} words.

Requirements:
- 8-15 H2 sections
- Include specific entities and data points where relevant: ${JSON.stringify(input.facts)}
- One section must be a "Frequently Asked Questions" H2
- Output ONLY a JSON array of H2 strings. No markdown, no numbering.

Example output: ["Introduction", "What is ...", "Key Features", ...]`;

export const STAGE3_DRAFT_PROMPT = (input: {
  styleTemplate: string;
  entityName: string;
  keywords: string[];
  targetWordCount: number;
  outline: string[];
  sectionFacts: Record<string, string[]>;
}): string => `${input.styleTemplate}

Write a complete article based on the following outline and facts.
Entity: ${input.entityName}
Keywords: ${input.keywords.join(', ')}
Target word count: ${input.targetWordCount}

Outline:
${input.outline.map(h => '- ' + h).join('\n')}

Facts to incorporate (MUST use these in the relevant sections):
${JSON.stringify(input.sectionFacts, null, 2)}

Critical rules:
1. Write in a natural, conversational tone as specified in the style template.
2. Include specific data, numbers, and comparisons from the facts provided.
3. Use short paragraphs and varied sentence structure.
4. Each H2 section must have at least 2-3 paragraphs.
5. Do NOT use phrases like "In conclusion" or "In this article".
6. Output the article in clean Markdown format (use ## for H2).
7. Include a markdown table if comparing products/specs.
8. End with a "Frequently Asked Questions" section with 3-5 Q&A pairs.`;

export const STAGE4_HUMANIZE_PROMPT = (draftMd: string): string => `Rewrite the following AI-generated article to sound more human.
Add personality, occasional opinions, and natural language patterns.

Rules:
- Inject 1-2 personal opinions or subjective statements (e.g., "Personally, I find...")
- Use contractions (don't, isn't, we'll)
- Vary sentence length dramatically (mix 3-word sentences with 25-word sentences)
- Add one rhetorical question
- Keep all factual data intact
- Keep all markdown formatting intact

Original article:
${draftMd}

Output the rewritten article in clean Markdown.`;

export const STAGE6_EEAT_EVALUATION_PROMPT = (html: string): string => `Evaluate the following article on E-E-A-T criteria (Experience, Expertise, Authoritativeness, Trustworthiness).
Score each dimension from 0 to 10.
Consider: Does it show first-hand experience? Is the information accurate and well-researched? Is the source trustworthy? Does it cite specific data?

Article:
${html.substring(0, 4000)}

Respond ONLY with JSON: {"experience": int, "expertise": int, "authoritativeness": int, "trustworthiness": int, "overall": int}`;

export const ENTITY_DISCOVERY_PROMPT = (seedKeyword: string): string => `You are a knowledge graph builder.
Given the topic "${seedKeyword}", list the top 15 most important entities (products, brands, technologies, people) that a comprehensive article must mention.

For each entity, provide:
- name: string
- type: "product" | "brand" | "technology" | "person"
- description: 1-2 sentence summary

Respond ONLY with a JSON array: [{"name": "...", "type": "...", "description": "..."}]`;

export const RELATION_MINING_PROMPT = (seedKeyword: string, entityList: string): string => `Given the following entities in the "${seedKeyword}" domain:
${entityList}

For each entity, list its relationships to other entities in the list.
Use predicates like: "competitor_of", "manufactured_by", "compatible_with", "part_of", "successor_of", "similar_to"

Respond ONLY with JSON: [{"subject": "EntityA", "predicate": "competitor_of", "object": "EntityB"}]`;

export const ATTRIBUTE_FILLING_PROMPT = (entityName: string, entityType: string): string => `For the entity "${entityName}" (type: ${entityType}), list its key factual attributes.
For a product: include price, rating, release_date, specs.
For a brand: include founded_year, headquarters, ceo, market_cap.
For a technology: include creator, release_year, version, purpose.

Respond ONLY with JSON: {"attributes": [{"key": "price", "value": "$999"}, ...]}`;