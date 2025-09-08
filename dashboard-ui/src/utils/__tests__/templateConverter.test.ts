import { describe, it, expect } from 'vitest';
import {
  visualConfigToHandlebars,
  validateVisualConfig,
  createEmptyVisualConfig
} from '../templateConverter';
import type { VisualConfig, VisualComponent } from '../templateConverter';
import type { Snippet } from '@/types/template';

const mockSnippets: Snippet[] = [
  {
    id: 'snippet-1',
    tenantId: 'tenant-1',
    name: 'article-card',
    description: 'Article card snippet',
    type: 'snippet',
    parameters: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'Article title'
      },
      {
        name: 'content',
        type: 'string',
        required: false,
        description: 'Article content'
      }
    ],
    s3Key: 'snippets/tenant-1/snippet-1.hbs',
    s3VersionId: 'v1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true
  }
];

describe('templateConverter', () => {
  describe('createEmptyVisualConfig', () => {
    it('creates empty config with default global styles', () => {
      const config = createEmptyVisualConfig();

      expect(config.components).toEqual([]);
      expect(config.globalStyles).toEqual({
        backgroundColor: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        maxWidth: '600px'
      });
    });
  });

  describe('validateVisualConfig', () => {
    it('validates empty config as valid', () => {
      const config = createEmptyVisualConfig();
      const result = validateVisualConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validates config with valid components', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'text',
            properties: {
              content: 'Hello World'
            }
          }
        ]
      };

      const result = validateVisualConfig(config);
      expect(result.isValid).toBe(true);
    });

    it('detects missing component properties', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'text',
            properties: {}
          }
        ]
      };

      const result = validateVisualConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Text component at index 0 is missing content');
    });
  });

  describe('visualConfigToHandlebars', () => {
    it('converts empty config to empty string', () => {
      const config = createEmptyVisualConfig();
      const result = visualConfigToHandlebars(config);

      expect(result).toBe('');
    });

    it('converts text component to handlebars', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'text',
            properties: {
              content: 'Hello World',
              fontSize: '18px',
              color: '#333333'
            }
          }
        ]
      };

      const result = visualConfigToHandlebars(config);
      expect(result).toContain('<div style="font-size: 18px; color: #333333;">Hello World</div>');
    });

    it('converts image component to handlebars', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'image',
            properties: {
              src: 'https://example.com/image.jpg',
              alt: 'Test image',
              width: '100%'
            }
          }
        ]
      };

      const result = visualConfigToHandlebars(config);
      expect(result).toContain('<img src="https://example.com/image.jpg" alt="Test image" style="width: 100%;" />');
    });

    it('converts button component to handlebars', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'button',
            properties: {
              text: 'Click Me',
              href: 'https://example.com',
              backgroundColor: '#007bff',
              color: '#ffffff'
            }
          }
        ]
      };

      const result = visualConfigToHandlebars(config);
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain('background-color: #007bff;');
      expect(result).toContain('color: #ffffff;');
      expect(result).toContain('Click Me');
    });

    it('converts snippet component to handlebars', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'snippet',
            properties: {
              snippetId: 'snippet-1',
              parameters: {
                title: 'My Article',
                content: 'Article content here'
              }
            }
          }
        ]
      };

      const result = visualConfigToHandlebars(config, mockSnippets);
      expect(result).toContain('{{> article-card title="My Article" content="Article content here"}}');
    });

    it('handles missing snippet gracefully', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'snippet',
            properties: {
              snippetId: 'nonexistent-snippet'
            }
          }
        ]
      };

      const result = visualConfigToHandlebars(config, mockSnippets);
      expect(result).toContain('<!-- Snippet component: Snippet "nonexistent-snippet" not found -->');
    });

    it('handles image without src', () => {
      const config: VisualConfig = {
        components: [
          {
            id: 'comp-1',
            type: 'image',
            properties: {
              alt: 'Test image'
            }
          }
        ]
      };

      const result = visualConfigToHandlebars(config);
      expect(result).toContain('<!-- Image component: No source URL specified -->');
    });
  });
});
