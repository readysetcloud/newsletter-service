import { describe, it, expect } from 'vitest';
import { buildShortcodeInsertion, filterSnippetsByName } from '../snippetShortcode';
import type { SnippetParameter } from '@/types/api';

const param = (over: Partial<SnippetParameter> & { name: string }): SnippetParameter => ({
  type: 'string',
  required: false,
  ...over,
});

describe('filterSnippetsByName', () => {
  const snippets = [
    { name: 'robotVoice' },
    { name: 'callout' },
    { name: 'codeBlock' },
  ];

  it('returns everything for an empty query', () => {
    expect(filterSnippetsByName(snippets, '')).toHaveLength(3);
    expect(filterSnippetsByName(snippets, '   ')).toHaveLength(3);
  });

  it('matches a case-insensitive substring on the name', () => {
    // 'l' appears in caLLout and codeBLock but not robotVoice; order preserved.
    expect(filterSnippetsByName(snippets, 'l')).toEqual([
      { name: 'callout' },
      { name: 'codeBlock' },
    ]);
    expect(filterSnippetsByName(snippets, 'VOICE')).toEqual([{ name: 'robotVoice' }]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterSnippetsByName(snippets, 'zzz')).toEqual([]);
  });
});

describe('buildShortcodeInsertion', () => {
  it('inserts a bare shortcode when there are no parameters', () => {
    expect(buildShortcodeInsertion({ name: 'divider' })).toBe('{{< divider >}}');
    expect(buildShortcodeInsertion({ name: 'divider', parameters: [] })).toBe('{{< divider >}}');
  });

  it('scaffolds every declared parameter as an empty attribute', () => {
    const out = buildShortcodeInsertion({
      name: 'robotVoice',
      parameters: [param({ name: 'text', type: 'textarea', required: true })],
    });
    expect(out).toBe('{{< robotVoice text="" >}}');
  });

  it('seeds attributes with default values when present', () => {
    const out = buildShortcodeInsertion({
      name: 'callout',
      parameters: [
        param({ name: 'label', defaultValue: 'Note' }),
        param({ name: 'body', required: true }),
      ],
    });
    expect(out).toBe('{{< callout label="Note" body="" >}}');
  });

  it('stringifies non-string default values', () => {
    const out = buildShortcodeInsertion({
      name: 'spacer',
      parameters: [param({ name: 'size', type: 'number', defaultValue: 3 })],
    });
    expect(out).toBe('{{< spacer size="3" >}}');
  });
});
