import {
  buildSuggestions,
  collectFieldPaths,
  getAutocompleteContext,
} from '../autocomplete';

describe('collectFieldPaths', () => {
  it('collects top-level keys', () => {
    expect(collectFieldPaths({ title: 'Hi', count: 3 })).toEqual(['title', 'count']);
  });

  it('collects nested dotted paths', () => {
    const paths = collectFieldPaths({ author: { name: 'A', email: 'e' } });
    expect(paths).toContain('author');
    expect(paths).toContain('author.name');
    expect(paths).toContain('author.email');
  });

  it('includes array keys but not indexed paths', () => {
    const paths = collectFieldPaths({ items: [1, 2, 3] });
    expect(paths).toEqual(['items']);
  });

  it('returns empty for non-objects', () => {
    expect(collectFieldPaths(null)).toEqual([]);
    expect(collectFieldPaths(42)).toEqual([]);
    expect(collectFieldPaths(['a'])).toEqual([]);
  });
});

describe('getAutocompleteContext', () => {
  it('detects a field expression inside a mustache', () => {
    const text = '<h1>{{ ti';
    const ctx = getAutocompleteContext(text, text.length);
    expect(ctx).toMatchObject({ kind: 'field', query: 'ti' });
    expect(ctx?.start).toBe(text.length - 2);
  });

  it('detects a partial reference', () => {
    const text = '{{> foo';
    const ctx = getAutocompleteContext(text, text.length);
    expect(ctx).toMatchObject({ kind: 'snippet', query: 'foo' });
  });

  it('detects a partial reference with no query yet', () => {
    const text = '{{> ';
    const ctx = getAutocompleteContext(text, text.length);
    expect(ctx).toMatchObject({ kind: 'snippet', query: '' });
  });

  it('returns null outside a mustache', () => {
    const text = '<h1>hello</h1>';
    expect(getAutocompleteContext(text, text.length)).toBeNull();
  });

  it('returns null once the mustache is closed', () => {
    const text = '{{ title }} after';
    expect(getAutocompleteContext(text, text.length)).toBeNull();
  });

  it('does not complete fields for block openers', () => {
    const text = '{{#each it';
    expect(getAutocompleteContext(text, text.length)).toBeNull();
  });
});

describe('buildSuggestions', () => {
  const fields = ['title', 'subtitle', 'author', 'author.name'];
  const snippets = [
    { name: 'footer', description: 'page footer' },
    { name: 'header' },
    { name: 'footnote' },
  ];

  it('filters field paths by prefix', () => {
    const ctx = { kind: 'field' as const, query: 'sub', start: 0 };
    const result = buildSuggestions(ctx, fields, snippets);
    expect(result.map((r) => r.value)).toEqual(['subtitle']);
  });

  it('excludes the exact match to avoid useless suggestions', () => {
    const ctx = { kind: 'field' as const, query: 'title', start: 0 };
    const result = buildSuggestions(ctx, fields, snippets);
    expect(result).toEqual([]);
  });

  it('filters snippet names by prefix', () => {
    const ctx = { kind: 'snippet' as const, query: 'foot', start: 0 };
    const result = buildSuggestions(ctx, fields, snippets);
    expect(result.map((r) => r.value)).toEqual(['footer', 'footnote']);
    expect(result[0].kind).toBe('snippet');
    expect(result[0].detail).toBe('page footer');
  });

  it('returns all fields for an empty query', () => {
    const ctx = { kind: 'field' as const, query: '', start: 0 };
    const result = buildSuggestions(ctx, fields, snippets);
    expect(result.length).toBe(fields.length);
  });
});
