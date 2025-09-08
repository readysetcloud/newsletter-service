import { describe, test, expect } from '@jest/globals';

describe('Template Functions Basic Tests', () => {
  test('list-templates function exports handler', async () => {
    const module = await import('../functions/templates/list-templates.mjs');
    expect(typeof module.handler).toBe('function');
  });

  test('get-template function exports handler', async () => {
    const module = await import('../functions/templates/get-template.mjs');
    expect(typeof module.handler).toBe('function');
  });

  test('create-template function exports handler', async () => {
    const module = await import('../functions/templates/create-template.mjs');
    expect(typeof module.handler).toBe('function');
  });

  test('update-template function exports handler', async () => {
    const module = await import('../functions/templates/update-template.mjs');
    expect(typeof module.handler).toBe('function');
  });

  test('delete-template function exports handler', async () => {
    const module = await import('../functions/templates/delete-template.mjs');
    expect(typeof module.handler).toBe('function');
  });

  test('template-engine utility functions exist', async () => {
    const module = await import('../functions/templates/utils/template-engine.mjs');
    expect(typeof module.renderTemplate).toBe('function');
    expect(typeof module.validateTemplate).toBe('function');
    expect(typeof module.extractUsedSnippets).toBe('function');
  });

  test('s3-storage utility functions exist', async () => {
    const module = await import('../functions/templates/utils/s3-storage.mjs');
    expect(typeof module.uploadTemplate).toBe('function');
    expect(typeof module.downloadTemplate).toBe('function');
    expect(typeof module.deleteTemplate).toBe('function');
    expect(typeof module.generateTemplateKey).toBe('function');
    expect(typeof module.generateSnippetKey).toBe('function');
  });

  test('template validation works with valid handlebars', async () => {
    const { validateTemplate } = await import('../functions/templates/utils/template-engine.mjs');

    const result = validateTemplate('<h1>{{title}}</h1><p>{{content}}</p>');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });



  test('extractUsedSnippets finds snippet references', async () => {
    const { extractUsedSnippets } = await import('../functions/templates/utils/template-engine.mjs');

    const template = `
      <h1>{{title}}</h1>
      {{> header-snippet}}
      <div>{{content}}</div>
      {{> footer-snippet param="value"}}
    `;

    const snippets = extractUsedSnippets(template);
    expect(snippets).toContain('header-snippet');
    expect(snippets).toContain('footer-snippet');
    expect(snippets).toHaveLength(2);
  });

  test('S3 key generation works correctly', async () => {
    const { generateTemplateKey, generateSnippetKey } = await import('../functions/templates/utils/s3-storage.mjs');

    const templateKey = generateTemplateKey('tenant-123', 'template-456');
    expect(templateKey).toBe('templates/tenant-123/template-456.hbs');

    const snippetKey = generateSnippetKey('tenant-123', 'snippet-789');
    expect(snippetKey).toBe('snippets/tenant-123/snippet-789.hbs');
  });
});
