import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  renderTemplate,
  renderSnippet,
  validateTemplate,
  validateSnippet,
  extractUsedSnippets,
  getSnippetById
} from '../functions/templates/utils/template-engine.mjs';

// Mock AWS SDK
const mockS3Send = jest.fn();
const mockDdbSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: mockS3Send
  })),
  GetObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockDdbSend
  })),
  QueryCommand: jest.fn(),
  GetItemCommand: jest.fn()
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

describe('Template Engine Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TEMPLATES_TABLE_NAME = 'test-templates-table';
    process.env.TEMPLATES_BUCKET_NAME = 'test-templates-bucket';
  });

  describe('extractUsedSnippets', () => {
    it('should extract snippet names from template content', () => {
      const templateContent = `
        <h1>{{title}}</h1>
        {{> header-snippet}}
        <div>{{content}}</div>
        {{> footer-snippet}}
        {{> header-snippet}}
      `;

      const result = extractUsedSnippets(templateContent);
      expect(result).toEqual(['header-snippet', 'footer-snippet']);
    });

    it('should handle templates with no snippets', () => {
      const templateContent = '<h1>{{title}}</h1><div>{{content}}</div>';
      const result = extractUsedSnippets(templateContent);
      expect(result).toEqual([]);
    });

    it('should handle snippet names with hyphens and underscores', () => {
      const templateContent = '{{> my-snippet}} {{> another_snippet}}';
      const result = extractUsedSnippets(templateContent);
      expect(result).toEqual(['my-snippet', 'another_snippet']);
    });

    it('should handle snippets with parameters', () => {
      const templateContent = '{{> card-snippet title="Test" content="Content"}} {{> button-snippet}}';
      const result = extractUsedSnippets(templateContent);
      expect(result).toEqual(['card-snippet', 'button-snippet']);
    });

    it('should handle complex snippet references', () => {
      const templateContent = `
        {{> header-snippet logo="/logo.png" title="My Site"}}
        {{#each articles}}
          {{> article-card title=this.title content=this.content}}
        {{/each}}
        {{> footer-snippet year=2024}}
      `;
      const result = extractUsedSnippets(templateContent);
      expect(result).toEqual(['header-snippet', 'article-card', 'footer-snippet']);
    });
  });

  describe('validateTemplate', () => {
    it('should validate correct handlebars syntax', () => {
      const templateContent = '<h1>{{title}}</h1><div>{{content}}</div>';
      const result = validateTemplate(templateContent);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle empty template content', () => {
      const result = validateTemplate('');

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toHaveProperty('message');
      expect(result.errors[0]).toHaveProperty('type', 'validation');
      expect(result.errors[0]).toHaveProperty('code', 'TEMPLATE_CONTENT_EMPTY');
    });

    it('should handle null or undefined content', () => {
      const result = validateTemplate(null);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toHaveProperty('code', 'TEMPLATE_CONTENT_REQUIRED');
    });

    it('should detect handlebars syntax errors', () => {
      const templateContent = '<h1>{{title</h1>'; // Missing closing brace
      const result = validateTemplate(templateContent);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty('type', 'syntax');
    });

    it('should validate snippet references', () => {
      const templateContent = '{{> invalid-snippet-name!}} {{> valid-snippet}}';
      const result = validateTemplate(templateContent);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_SNIPPET_NAME')).toBe(true);
    });

    it('should detect reserved snippet names', () => {
      const templateContent = '{{> if}} {{> each}}';
      const result = validateTemplate(templateContent);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'RESERVED_SNIPPET_NAME')).toBe(true);
    });

    it('should warn about potential XSS vulnerabilities', () => {
      const templateContent = '{{{<script>alert("xss")</script>}}}';
      const result = validateTemplate(templateContent);

      expect(result.warnings.some(w => w.code === 'POTENTIAL_XSS_SCRIPT')).toBe(true);
    });

    it('should warn about missing alt attributes', () => {
      const templateContent = '<img src="{{imageUrl}}">';
      const result = validateTemplate(templateContent);

      expect(result.warnings.some(w => w.code === 'MISSING_ALT_ATTRIBUTE')).toBe(true);
    });

    it('should warn about inline styles', () => {
      const templateContent = '<div style="color: red;">{{content}}</div>';
      const result = validateTemplate(templateContent);

      expect(result.warnings.some(w => w.code === 'INLINE_STYLES')).toBe(true);
    });

    it('should handle large templates', () => {
      const largeContent = 'x'.repeat(1000001); // > 1MB
      const result = validateTemplate(largeContent);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'TEMPLATE_SIZE_EXCEEDED')).toBe(true);
    });

    it('should detect deep nesting', () => {
      const deeplyNested = '{{#each items}}{{#if condition}}{{#with data}}{{#unless hidden}}{{#each nested}}{{#if show}}{{#with item}}{{#unless skip}}{{#each deep}}{{#if final}}{{content}}{{/if}}{{/each}}{{/unless}}{{/with}}{{/if}}{{/each}}{{/unless}}{{/with}}{{/if}}{{/with}}{{/each}}';
      const result = validateTemplate(deeplyNested);

      expect(result.warnings.some(w => w.code === 'DEEP_NESTING')).toBe(true);
    });
  });

  describe('validateSnippet', () => {
    it('should validate correct snippet syntax', () => {
      const snippetContent = '<div class="{{className}}">{{content}}</div>';
      const result = validateSnippet(snippetContent);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle empty snippet content', () => {
      const result = validateSnippet('');

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toHaveProperty('type', 'validation');
      expect(result.errors[0]).toHaveProperty('code', 'SNIPPET_CONTENT_EMPTY');
    });

    it('should validate snippet with parameters', () => {
      const snippetContent = '<div class="{{className}}">{{title}}: {{content}}</div>';
      const parameters = [
        { name: 'className', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
        { name: 'content', type: 'string', required: false }
      ];
      const result = validateSnippet(snippetContent, parameters);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should warn about unused required parameters', () => {
      const snippetContent = '<div>{{title}}</div>';
      const parameters = [
        { name: 'title', type: 'string', required: true },
        { name: 'unused', type: 'string', required: true }
      ];
      const result = validateSnippet(snippetContent, parameters);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.code === 'UNUSED_REQUIRED_PARAMETER')).toBe(true);
    });

    it('should warn about undefined parameters', () => {
      const snippetContent = '<div>{{title}} {{undefinedVar}}</div>';
      const parameters = [
        { name: 'title', type: 'string', required: true }
      ];
      const result = validateSnippet(snippetContent, parameters);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.code === 'UNDEFINED_PARAMETER')).toBe(true);
    });

    it('should warn about too many parameters', () => {
      const parameters = Array.from({ length: 15 }, (_, i) => ({
        name: `param${i}`,
        type: 'string',
        required: false
      }));
      const result = validateSnippet('<div>{{param0}}</div>', parameters);

      expect(result.warnings.some(w => w.code === 'TOO_MANY_PARAMETERS')).toBe(true);
    });

    it('should warn about missing parameter descriptions', () => {
      const parameters = [
        { name: 'title', type: 'string', required: true },
        { name: 'content', type: 'string', required: false, description: '' }
      ];
      const result = validateSnippet('<div>{{title}}</div>', parameters);

      expect(result.warnings.some(w => w.code === 'MISSING_PARAMETER_DESCRIPTION')).toBe(true);
    });

    it('should calculate complexity score', () => {
      const complexSnippet = `
        {{#each items}}
          {{#if condition}}
            {{#unless hidden}}
              <div>{{title}}</div>
            {{/unless}}
          {{/if}}
        {{/each}}
      `;
      const result = validateSnippet(complexSnippet);

      expect(result.warnings.some(w => w.code === 'HIGH_COMPLEXITY')).toBe(true);
    });

    it('should handle large snippets', () => {
      const largeContent = 'x'.repeat(100001); // > 100KB
      const result = validateSnippet(largeContent);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'SNIPPET_SIZE_EXCEEDED')).toBe(true);
    });
  });

  describe('renderSnippet', () => {
    it('should render snippet with parameters', () => {
      const snippetContent = '<div class="card"><h3>{{title}}</h3><p>{{content}}</p></div>';
      const params = { title: 'Test Title', content: 'Test content' };

      const result = renderSnippet(snippetContent, params);
      expect(result).toBe('<div class="card"><h3>Test Title</h3><p>Test content</p></div>');
    });

    it('should handle missing parameters gracefully', () => {
      const snippetContent = '<div>{{title}}</div>';
      const params = {};

      const result = renderSnippet(snippetContent, params);
      expect(result).toBe('<div></div>');
    });

    it('should handle empty parameters object', () => {
      const snippetContent = '<div>Static content</div>';

      const result = renderSnippet(snippetContent);
      expect(result).toBe('<div>Static content</div>');
    });

    it('should throw error for invalid handlebars syntax', () => {
      const invalidSnippet = '<div>{{title</div>'; // Missing closing brace

      expect(() => {
        renderSnippet(invalidSnippet, {});
      }).toThrow('Snippet rendering failed');
    });

    it('should render conditional content', () => {
      const snippetContent = '{{#if showTitle}}<h1>{{title}}</h1>{{/if}}<p>{{content}}</p>';
      const params = { showTitle: true, title: 'My Title', content: 'My content' };

      const result = renderSnippet(snippetContent, params);
      expect(result).toBe('<h1>My Title</h1><p>My content</p>');
    });

    it('should render loops', () => {
      const snippetContent = '<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>';
      const params = { items: ['Item 1', 'Item 2', 'Item 3'] };

      const result = renderSnippet(snippetContent, params);
      expect(result).toBe('<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>');
    });

    it('should handle complex data structures', () => {
      const snippetContent = `
        <div class="article">
          <h2>{{article.title}}</h2>
          <p>By {{article.author.name}} on {{article.date}}</p>
          <div>{{article.content}}</div>
          {{#if article.tags}}
            <div class="tags">
              {{#each article.tags}}
                <span class="tag">{{this}}</span>
              {{/each}}
            </div>
          {{/if}}
        </div>
      `;
      const params = {
        article: {
          title: 'Test Article',
          author: { name: 'John Doe' },
          date: '2024-01-01',
          content: 'Article content here',
          tags: ['tech', 'javascript']
        }
      };

      const result = renderSnippet(snippetContent, params);
      expect(result).toContain('Test Article');
      expect(result).toContain('John Doe');
      expect(result).toContain('tech');
      expect(result).toContain('javascript');
    });
  });

  describe('renderTemplate', () => {
    beforeEach(() => {
      // Mock snippet retrieval
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            id: 'header-snippet',
            name: 'header-snippet',
            s3Key: 'snippets/tenant1/header-snippet.hbs'
          }
        ]
      });

      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve('<header>{{title}}</header>')
        }
      });
    });

    it('should render template with snippets', async () => {
      const templateContent = '<div>{{> header-snippet}}<main>{{content}}</main></div>';
      const data = { title: 'My Site', content: 'Main content' };

      const result = await renderTemplate(templateContent, data, 'tenant1');
      expect(result).toContain('<header>My Site</header>');
      expect(result).toContain('<main>Main content</main>');
    });

    it('should handle template without snippets', async () => {
      const templateContent = '<div><h1>{{title}}</h1><p>{{content}}</p></div>';
      const data = { title: 'Test Title', content: 'Test content' };

      const result = await renderTemplate(templateContent, data, 'tenant1');
      expect(result).toBe('<div><h1>Test Title</h1><p>Test content</p></div>');
    });

    it('should handle snippet loading errors gracefully', async () => {
      mockDdbSend.mockRejectedValue(new Error('DynamoDB error'));

      const templateContent = '<div>{{> missing-snippet}}<p>{{content}}</p></div>';
      const data = { content: 'Test content' };

      // Should not throw, but continue rendering
      const result = await renderTemplate(templateContent, data, 'tenant1');
      expect(result).toContain('Test content');
    });

    it('should throw error for invalid template syntax', async () => {
      const invalidTemplate = '<div>{{title</div>'; // Missing closing brace
      const data = { title: 'Test' };

      await expect(renderTemplate(invalidTemplate, data, 'tenant1')).rejects.toThrow('Template rendering failed');
    });
  });

  describe('getSnippetById', () => {
    it('should retrieve snippet with content', async () => {
      const mockSnippet = {
        id: 'snippet-123',
        name: 'test-snippet',
        s3Key: 'snippets/tenant1/snippet-123.hbs',
        parameters: [{ name: 'title', type: 'string', required: true }]
      };

      mockDdbSend.mockResolvedValue({
        Items: [mockSnippet]
      });

      mockS3Send.mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve('<div>{{title}}</div>')
        }
      });

      const result = await getSnippetById('tenant1', 'snippet-123');

      expect(result).toEqual({
        ...mockSnippet,
        content: '<div>{{title}}</div>'
      });
    });

    it('should throw error for non-existent snippet', async () => {
      mockDdbSend.mockResolvedValue({
        Items: []
      });

      await expect(getSnippetById('tenant1', 'non-existent')).rejects.toThrow('Snippet non-existent not found');
    });

    it('should handle S3 errors', async () => {
      mockDdbSend.mockResolvedValue({
        Items: [{
          id: 'snippet-123',
          s3Key: 'snippets/tenant1/snippet-123.hbs'
        }]
      });

      mockS3Send.mockRejectedValue(new Error('S3 error'));

      await expect(getSnippetById('tenant1', 'snippet-123')).rejects.toThrow('S3 error');
    });
  });
});
