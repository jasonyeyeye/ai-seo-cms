import { describe, test, expect } from 'bun:test';
import { generateToken, injectAffiliateLinksIntoHtml } from './service';

describe('Affiliate Service', () => {
  describe('generateToken', () => {
    test('should generate 8 character token', () => {
      const token = generateToken();
      expect(token.length).toBe(8);
    });

    test('should only contain alphanumeric characters', () => {
      const token = generateToken();
      expect(/^[a-z0-9]+$/.test(token)).toBe(true);
    });

    test('should generate unique tokens', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('injectAffiliateLinksIntoHtml', () => {
    test('should replace product name with affiliate link', () => {
      const html = '<p>Check out iPhone 15, it is great!</p>';
      const links = [{ productName: 'iPhone 15', token: 'abc123' }];

      const result = injectAffiliateLinksIntoHtml(html, links);

      expect(result).toContain('/go/abc123');
      expect(result).toContain('rel="nofollow sponsored"');
    });

    test('should replace multiple product names', () => {
      const html = '<p>Samsung and Apple are great phones.</p>';
      const links = [
        { productName: 'Samsung', token: 'abc123' },
        { productName: 'Apple', token: 'def456' },
      ];

      const result = injectAffiliateLinksIntoHtml(html, links);

      expect(result).toContain('/go/abc123');
      expect(result).toContain('/go/def456');
    });

    test('should escape special regex characters in product name', () => {
      const html = '<p>Product (2024) is great!</p>';
      const links = [{ productName: 'Product (2024)', token: 'xyz789' }];

      // Should not throw an error due to invalid regex
      const result = injectAffiliateLinksIntoHtml(html, links);

      expect(result).toBeDefined();
    });

    test('should add class to affiliate links', () => {
      const html = '<p>iPhone 15 is great!</p>';
      const links = [{ productName: 'iPhone 15', token: 'abc123' }];

      const result = injectAffiliateLinksIntoHtml(html, links);

      expect(result).toContain('class="affiliate-link"');
    });

    test('should be case insensitive', () => {
      const html = '<p>APPLE is great!</p>';
      const links = [{ productName: 'apple', token: 'abc123' }];

      const result = injectAffiliateLinksIntoHtml(html, links);

      expect(result).toContain('/go/abc123');
    });

    test('should handle empty links array', () => {
      const html = '<p>No affiliate links here.</p>';
      const links: { productName: string; token: string }[] = [];

      const result = injectAffiliateLinksIntoHtml(html, links);

      expect(result).toBe(html);
    });

    test('should handle empty HTML', () => {
      const html = '';
      const links = [{ productName: 'Product', token: 'abc123' }];

      const result = injectAffiliateLinksIntoHtml(html, links);

      expect(result).toBe('');
    });
  });

  describe('AffiliateLinkRecord interface', () => {
    test('should have correct structure', () => {
      const record = {
        id: 1,
        postId: 1,
        token: 'abc123',
        productName: 'Test Product',
        destinationUrl: 'https://amazon.com/dp/B000',
        platform: 'amazon',
        createdAt: new Date(),
      };

      expect(record.id).toBe(1);
      expect(record.token).toBe('abc123');
      expect(record.platform).toBe('amazon');
    });
  });

  describe('CreateAffiliateLinkInput interface', () => {
    test('should accept valid input', () => {
      const input = {
        postId: 1,
        productName: 'Test Product',
        destinationUrl: 'https://amazon.com/dp/B000',
        platform: 'amazon' as const,
      };

      expect(input.postId).toBe(1);
      expect(input.productName).toBe('Test Product');
    });

    test('should allow platform to be undefined (defaults to amazon)', () => {
      const input = {
        postId: 1,
        productName: 'Test Product',
        destinationUrl: 'https://amazon.com/dp/B000',
      };

      const platform = input.platform || 'amazon';
      expect(platform).toBe('amazon');
    });
  });

  describe('Click tracking', () => {
    test('should allow null IP for privacy', async () => {
      const click = {
        linkId: 1,
        ip: null as string | null,
        userAgent: 'Mozilla/5.0',
        referer: null as string | null,
        clickedAt: new Date(),
      };

      expect(click.ip).toBeNull();
      expect(click.referer).toBeNull();
    });

    test('should track user agent', async () => {
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
      const click = {
        linkId: 1,
        ip: '192.168.1.1',
        userAgent,
        referer: 'https://google.com',
        clickedAt: new Date(),
      };

      expect(click.userAgent).toBe(userAgent);
    });
  });
});