/**
 * Unit tests for URL normalizer module
 */

import { normalizeUrl } from '../url-normalizer.mjs';

describe('normalizeUrl', () => {
  describe('hostname normalization', () => {
    it('should lowercase the hostname', () => {
      expect(normalizeUrl('https://EXAMPLE.COM/path')).toBe('https://example.com/path');
    });

    it('should lowercase mixed-case hostnames', () => {
      expect(normalizeUrl('https://Blog.Example.COM/article')).toBe('https://blog.example.com/article');
    });
  });

  describe('tracking param removal', () => {
    it('should strip utm_source', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=twitter'))
        .toBe('https://example.com/page');
    });

    it('should strip all utm_* params', () => {
      const url = 'https://example.com/page?utm_source=twitter&utm_medium=social&utm_campaign=launch&utm_term=test&utm_content=cta';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('should strip fbclid', () => {
      expect(normalizeUrl('https://example.com/page?fbclid=abc123'))
        .toBe('https://example.com/page');
    });

    it('should strip gclid', () => {
      expect(normalizeUrl('https://example.com/page?gclid=xyz'))
        .toBe('https://example.com/page');
    });

    it('should strip msclkid, dclid, twclkd', () => {
      const url = 'https://example.com/page?msclkid=a&dclid=b&twclkd=c';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('should strip mc_cid, mc_eid, ref, _hsenc, _hsmi', () => {
      const url = 'https://example.com/page?mc_cid=a&mc_eid=b&ref=c&_hsenc=d&_hsmi=e';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('should strip tracking params case-insensitively', () => {
      expect(normalizeUrl('https://example.com/page?UTM_SOURCE=twitter'))
        .toBe('https://example.com/page');
    });
  });

  describe('non-tracking param preservation', () => {
    it('should preserve non-tracking query params', () => {
      const result = normalizeUrl('https://example.com/search?q=serverless&page=2');
      expect(result).toContain('q=serverless');
      expect(result).toContain('page=2');
    });

    it('should preserve non-tracking params while stripping tracking ones', () => {
      const result = normalizeUrl('https://example.com/search?q=test&utm_source=twitter&page=1');
      expect(result).toContain('q=test');
      expect(result).toContain('page=1');
      expect(result).not.toContain('utm_source');
    });

    it('should sort remaining params for consistency', () => {
      const result = normalizeUrl('https://example.com/search?z=last&a=first');
      expect(result).toBe('https://example.com/search?a=first&z=last');
    });
  });

  describe('trailing slash removal', () => {
    it('should remove a single trailing slash from path', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    });

    it('should remove multiple trailing slashes', () => {
      expect(normalizeUrl('https://example.com/path///')).toBe('https://example.com/path');
    });

    it('should preserve root path as /', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('should not alter paths without trailing slashes', () => {
      expect(normalizeUrl('https://example.com/path')).toBe('https://example.com/path');
    });
  });

  describe('unparseable URLs', () => {
    it('should return null for empty string', () => {
      expect(normalizeUrl('')).toBeNull();
    });

    it('should return null for non-URL strings', () => {
      expect(normalizeUrl('not a url')).toBeNull();
    });

    it('should return null for relative paths', () => {
      expect(normalizeUrl('/just/a/path')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(normalizeUrl(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(normalizeUrl(undefined)).toBeNull();
    });
  });

  describe('combined normalization', () => {
    it('should apply all normalizations together', () => {
      const raw = 'https://BLOG.Example.COM/article/?utm_source=twitter&q=test&fbclid=abc';
      expect(normalizeUrl(raw)).toBe('https://blog.example.com/article?q=test');
    });

    it('should be idempotent', () => {
      const raw = 'https://Example.COM/path/?utm_source=twitter&q=test';
      const first = normalizeUrl(raw);
      const second = normalizeUrl(first);
      expect(second).toBe(first);
    });
  });
});
