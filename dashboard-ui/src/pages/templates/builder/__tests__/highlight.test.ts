import { escapeHtml, highlightHandlebars } from '../highlight';

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('highlightHandlebars', () => {
  it('wraps a variable mustache in a hbs-var span', () => {
    const html = highlightHandlebars('{{ title }}');
    expect(html).toContain('class="hbs-var"');
    expect(html).toContain('{{ title }}');
  });

  it('classifies partials, blocks, and comments', () => {
    expect(highlightHandlebars('{{> footer }}')).toContain('class="hbs-partial"');
    expect(highlightHandlebars('{{#each items}}')).toContain('class="hbs-block"');
    expect(highlightHandlebars('{{/each}}')).toContain('class="hbs-block"');
    expect(highlightHandlebars('{{! note }}')).toContain('class="hbs-comment"');
  });

  it('escapes surrounding HTML text', () => {
    const html = highlightHandlebars('<h1>{{ title }}</h1>');
    expect(html).toContain('&lt;h1&gt;');
    expect(html).toContain('&lt;/h1&gt;');
  });

  it('handles content with no mustaches', () => {
    expect(highlightHandlebars('plain text')).toBe('plain text');
  });
});
