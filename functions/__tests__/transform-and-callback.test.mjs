import { removeEmailHashPlaceholder } from '../transform-and-callback.mjs';

describe('transform-and-callback', () => {
  test('removes subscriber hash placeholder before callback persistence', () => {
    const content = [
      '[first](https://redirect.example.com/r?u=https://example.com&cid=tenant%2342&p=1&s=__EMAIL_HASH__)',
      '[second](https://redirect.example.com/r?u=https://example.com&s=__EMAIL_HASH__&cid=tenant%2342&p=2)',
      '[third](https://redirect.example.com/r?s=__EMAIL_HASH__&u=https://example.com)'
    ].join('\n');

    const result = removeEmailHashPlaceholder(content);

    expect(result).not.toContain('__EMAIL_HASH__');
    expect(result).toContain('https://redirect.example.com/r?u=https://example.com&cid=tenant%2342&p=1');
    expect(result).toContain('https://redirect.example.com/r?u=https://example.com&cid=tenant%2342&p=2');
    expect(result).toContain('https://redirect.example.com/r?u=https://example.com');
  });
});
