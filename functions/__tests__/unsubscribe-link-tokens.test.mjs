import { describe, test, expect, beforeAll } from '@jest/globals';
import { encrypt, decrypt } from '../utils/helpers.mjs';

/**
 * The unsubscribe and preference-centre links carry `encrypt(email)` in a query
 * string. `encrypt` emits standard base64, whose alphabet includes `+` — and a
 * `+` in a query value decodes to a space. Node's base64 decoder then skips the
 * space instead of failing on it, so every following byte shifts and AES-GCM
 * rejects the payload: the click 404s into "invalid or expired link", the
 * subscriber stays subscribed, and the issue's `unsubscribes` counter never
 * moves.
 */
const asDeliveredThroughAQueryString = (token) => token.replace(/\+/g, ' ');

describe('unsubscribe link tokens survive the query string', () => {
  beforeAll(() => {
    process.env.EMAIL_ENCRYPTION_KEY = 'test-encryption-key';
  });

  test('percent-encoding a token keeps every character intact', () => {
    // Sample enough addresses that a `+`-bearing token is a certainty rather
    // than a coin flip — roughly seven in ten tokens contain one.
    for (let i = 0; i < 200; i++) {
      const email = `subscriber${i}@example.com`;
      const encoded = encodeURIComponent(encrypt(email));

      expect(encoded).not.toContain('+');
      expect(decrypt(decodeURIComponent(encoded))).toBe(email);
    }
  });

  // Links in already-delivered emails cannot be recalled and will keep arriving
  // corrupted, so the repair has to happen on the way in.
  test('a token whose + became a space still decrypts', () => {
    let corrupted = 0;

    for (let i = 0; i < 200; i++) {
      const email = `subscriber${i}@example.com`;
      const token = encrypt(email);
      const delivered = asDeliveredThroughAQueryString(token);

      if (delivered !== token) {
        corrupted++;
      }

      expect(decrypt(delivered)).toBe(email);
    }

    // Guards the fixture itself: if encryption ever stopped producing `+`, the
    // test above would pass without exercising anything.
    expect(corrupted).toBeGreaterThan(0);
  });

  test('an actually corrupt token is still rejected', () => {
    const token = encrypt('subscriber@example.com');
    const tampered = token.slice(0, -4) + 'AAAA';

    expect(() => decrypt(tampered)).toThrow(/Decryption failed/);
  });
});
