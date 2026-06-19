import { describe, it, expect } from 'vitest';
import { formatMarkdown, escapeHtml, escapeHtmlAttribute } from '../markdown';

describe('formatMarkdown', () => {
  it('renders headings, bold and italic', () => {
    const html = formatMarkdown('# Title\n\nSome **bold** and *italic* text');
    expect(html).toContain('<h1 class="text-2xl font-bold mt-8 mb-4 text-foreground">Title</h1>');
    expect(html).toContain('<strong class="font-bold">bold</strong>');
    expect(html).toContain('<em class="italic">italic</em>');
  });

  it('renders links with the default styling when no custom renderer is provided', () => {
    const html = formatMarkdown('Check [the docs](https://example.com/docs)');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('>the docs</a>');
    expect(html).toContain('target="_blank"');
  });

  it('passes anchor text, url and a document-order index to a custom link renderer', () => {
    const seen: Array<{ anchorText: string; url: string; index: number }> = [];
    formatMarkdown('[first](https://a.com) then [second](https://b.com)', {
      renderLink: (anchorText, url, ctx) => {
        seen.push({ anchorText, url, index: ctx.index });
        return `<a data-i="${ctx.index}">${anchorText}</a>`;
      },
    });

    expect(seen).toEqual([
      { anchorText: 'first', url: 'https://a.com', index: 0 },
      { anchorText: 'second', url: 'https://b.com', index: 1 },
    ]);
  });

  it('uses the custom renderer output verbatim', () => {
    const html = formatMarkdown('[x](https://a.com)', {
      renderLink: (anchorText) => `<span class="custom">${anchorText}</span>`,
    });
    expect(html).toContain('<span class="custom">x</span>');
  });

  it('does not misinterpret $ characters in URLs (function replacer is literal)', () => {
    const html = formatMarkdown('[pay](https://a.com/?amount=$5&ref=$1)');
    expect(html).toContain('href="https://a.com/?amount=$5&ref=$1"');
  });
});

describe('escapeHtml / escapeHtmlAttribute', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('a & b <c>')).toBe('a &amp; b &lt;c&gt;');
  });

  it('additionally escapes double quotes for attributes', () => {
    expect(escapeHtmlAttribute('say "hi" & <go>')).toBe('say &quot;hi&quot; &amp; &lt;go&gt;');
  });
});
