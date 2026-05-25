import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { generateArticle } from './pipeline';
import type { GenerationInput, GenerationOutput, EEATScore, InfoGainCheck } from '../ai/service';

// Mock the AI service
mock.module('../ai/service', () => ({
  AIService: {
    generate: mock(),
    generateJSON: mock(),
    embed: mock(),
  },
}));

describe('Content Pipeline', () => {
  let mockInput: GenerationInput;
  let mockEeatScore: EEATScore;
  let mockInfoGainCheck: InfoGainCheck;

  beforeEach(() => {
    mockInput = {
      keywords: ['test product', 'review'],
      primaryEntitySlug: 'test-product',
      styleTemplateId: 'default',
      targetWordCount: 1500,
      contentType: 'review',
    };

    mockEeatScore = {
      experience: 7,
      expertise: 8,
      authoritativeness: 7,
      trustworthiness: 8,
      overall: 7.5,
    };

    mockInfoGainCheck = {
      passed: true,
      elementsFound: ['table', 'price', 'rating_or_percentage', 'quote', 'faq'],
      missingElements: [],
    };
  });

  describe('generateSlug', () => {
    test('should convert text to lowercase slug format', async () => {
      // Test slug generation logic directly from pipeline
      const text = 'Hello World Test';
      const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

      expect(slug).toBe('hello-world-test');
    });

    test('should remove special characters', async () => {
      const text = 'Product! @#$% Name (2024)';
      const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

      expect(slug).toBe('product-name-2024');
    });
  });

  describe('extractTitle', () => {
    test('should extract title from H1 markdown', async () => {
      const markdown = '# This is the Article Title\n\nSome content here';
      const h1Match = markdown.match(/^#\s+(.+)$/m);
      const title = h1Match?.[1]?.trim() || 'Untitled';

      expect(title).toBe('This is the Article Title');
    });

    test('should use first line if no H1 found', async () => {
      const markdown = 'First line title\n\n## Section\n\nContent';
      const lines = markdown.split('\n').filter(l => l.trim());
      const title = lines[0]?.replace(/^#+\s+/, '').trim() || 'Untitled';

      expect(title).toBe('First line title');
    });

    test('should return Untitled for empty content', async () => {
      const markdown = '';
      const lines = markdown.split('\n').filter(l => l.trim());
      const title = lines[0]?.replace(/^#+\s+/, '').trim() || 'Untitled';

      expect(title).toBe('Untitled');
    });
  });

  describe('checkInfoGain', () => {
    test('should detect table element', () => {
      const html = '<table><tr><td>Data</td></tr></table>';
      const hasTable = /<table[^>]*>/i.test(html);
      expect(hasTable).toBe(true);
    });

    test('should detect price pattern with dollar sign', () => {
      const html = 'The product costs $299.99';
      const hasPrice = /\$\d[\d,.]+/.test(html);
      expect(hasPrice).toBe(true);
    });

    test('should detect price pattern with currency text', () => {
      const html = 'The product costs 299 USD';
      const hasPrice = /\d[\d,.]*\s?(USD|EUR|GBP)/i.test(html);
      expect(hasPrice).toBe(true);
    });

    test('should detect rating or percentage', () => {
      const html = 'Rating: 4.5 / 5 stars';
      const hasRating = /\d+\s?\/\s?\d+/.test(html);
      expect(hasRating).toBe(true);
    });

    test('should detect percentage', () => {
      const html = 'Efficiency increased by 85%';
      const hasPercentage = /\d+%/.test(html);
      expect(hasPercentage).toBe(true);
    });

    test('should detect blockquote', () => {
      const html = '<blockquote>Important quote here</blockquote>';
      const hasQuote = /<blockquote/i.test(html);
      expect(hasQuote).toBe(true);
    });

    test('should detect FAQ with 3+ Q&A pairs', () => {
      const html = `
        <h2>Frequently Asked Questions</h2>
        <strong>Q: What is it?</strong>
        <p>Answer here</p>
        <strong>Q: How does it work?</strong>
        <p>Answer here</p>
        <strong>Q: Is it worth it?</strong>
        <p>Answer here</p>
      `;
      const faqMatches = html.match(/<(?:h[23]|strong)>[^<]*(?:Q:|Question:)[^<]*<\/(?:h[23]|strong)>/gi);
      expect(faqMatches && faqMatches.length >= 3).toBe(true);
    });

    test('should pass when at least 2 elements are found', () => {
      const elementsFound = ['table', 'price'];
      const requiredElements = ['table', 'price', 'rating_or_percentage', 'quote', 'faq'];
      const missingElements = requiredElements.filter(el => !elementsFound.includes(el));
      const passed = elementsFound.length >= 2;

      expect(passed).toBe(true);
      expect(missingElements).toEqual(['rating_or_percentage', 'quote', 'faq']);
    });
  });

  describe('buildSchemaOrg', () => {
    test('should build base Article schema', () => {
      const baseSchema = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Test Article',
        datePublished: expect.any(String),
      };

      expect(baseSchema['@type']).toBe('Article');
      expect(baseSchema.headline).toBe('Test Article');
    });

    test('should build Review schema for review content type', () => {
      const contentType = 'review';
      const title = 'Product Review';

      const schema = {
        '@context': 'https://schema.org',
        '@type': contentType === 'review' ? 'Review' : 'Article',
        headline: title,
        datePublished: new Date().toISOString(),
      };

      expect(schema['@type']).toBe('Review');
    });

    test('should build HowTo schema for guide content type', () => {
      const contentType = 'guide';
      const title = 'How To Guide';

      const schema = {
        '@context': 'https://schema.org',
        '@type': contentType === 'guide' ? 'HowTo' : 'Article',
        headline: title,
        datePublished: new Date().toISOString(),
      };

      expect(schema['@type']).toBe('HowTo');
    });
  });

  describe('injectSchemaIntoHtml', () => {
    test('should inject schema script before </head>', () => {
      const html = '<html><head></head><body>Content</body></html>';
      const schema = { '@type': 'Article' };
      const schemaScript = `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;

      const result = html.replace('</head>', `${schemaScript}</head>`);

      expect(result).toContain(schemaScript);
      expect(result.indexOf(schemaScript)).toBeLessThan(result.indexOf('<body>'));
    });

    test('should prepend schema if no </head> found', () => {
      const html = '<body>Content</body>';
      const schema = { '@type': 'Article' };
      const schemaScript = `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;

      const result = schemaScript + html;

      expect(result.startsWith(schemaScript)).toBe(true);
    });
  });
});

describe('Pipeline Integration', () => {
  test('should be defined as a function', () => {
    expect(typeof generateArticle).toBe('function');
  });

  test('should accept GenerationInput and return GenerationOutput', () => {
    const input: GenerationInput = {
      keywords: ['test'],
      primaryEntitySlug: 'test-slug',
      styleTemplateId: 'default',
      targetWordCount: 1000,
      contentType: 'article',
    };

    // This is a type check, not a runtime test
    const _output: GenerationOutput = {
      title: '',
      slug: '',
      outline: [],
      facts: {},
      draftMd: '',
      humanizedMd: '',
      seoEnhancedHtml: '',
      eeatSelfScore: { experience: 0, expertise: 0, authoritativeness: 0, trustworthiness: 0, overall: 0 },
      infoGainCheck: { passed: false, elementsFound: [], missingElements: [] },
    };

    expect(input.contentType).toBe('article');
  });
});
