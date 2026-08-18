import { describe, test, expect, beforeAll } from '@jest/globals';
import { mintSubscriberToken, readSubscriberToken } from '../utils/subscriber-token.mjs';
import { encrypt } from '../utils/helpers.mjs';

describe('subscriber tokens are bound to a tenant', () => {
  beforeAll(() => {
    process.env.EMAIL_ENCRYPTION_KEY = 'test-encryption-key';
  });

  test('round-trips the address for the tenant it was minted for', () => {
    const token = mintSubscriberToken('tenant-a', 'person@example.com');

    expect(readSubscriberToken(token, 'tenant-a')).toEqual({
      email: 'person@example.com',
      legacy: false
    });
  });

  // The replay this version exists to stop: the address rode in the token while
  // the tenant came from the URL, so the same token applied to any tenant's
  // endpoint — unsubscribing the person there and planting a suppression under
  // a tenant they may never have been on.
  test('refuses a token minted for a different tenant', () => {
    const token = mintSubscriberToken('tenant-a', 'person@example.com');

    expect(() => readSubscriberToken(token, 'tenant-b'))
      .toThrow(/minted for a different tenant/);
  });

  // Every already-delivered email carries one of these, and those unsubscribe
  // links have to keep working; they are flagged so the tail-off is visible.
  test('accepts a legacy bare-address token and flags it', () => {
    const legacyToken = encrypt('old@example.com');

    expect(readSubscriberToken(legacyToken, 'any-tenant')).toEqual({
      email: 'old@example.com',
      legacy: true
    });
  });

  test('refuses a payload with the wrong purpose or version', () => {
    const wrongPurpose = encrypt(JSON.stringify({
      v: 2, purpose: 'something-else', tenantId: 't', email: 'a@b.com'
    }));
    const wrongVersion = encrypt(JSON.stringify({
      v: 99, purpose: 'subscriber-link', tenantId: 't', email: 'a@b.com'
    }));

    expect(() => readSubscriberToken(wrongPurpose, 't')).toThrow(/wrong purpose/);
    expect(() => readSubscriberToken(wrongVersion, 't')).toThrow(/Unrecognized/);
  });

  test('refuses a token that carries no address', () => {
    const noEmail = encrypt(JSON.stringify({
      v: 2, purpose: 'subscriber-link', tenantId: 't'
    }));

    expect(() => readSubscriberToken(noEmail, 't')).toThrow(/no email address/);
  });

  test('refuses a token it cannot decrypt', () => {
    expect(() => readSubscriberToken('not-a-token', 'tenant-a')).toThrow(/Decryption failed/);
  });
});
