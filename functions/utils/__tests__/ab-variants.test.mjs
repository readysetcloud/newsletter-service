/**
 * Unit tests for deterministic A/B variant assignment utilities.
 */

import { hashToInt, pickVariant, splitRecipients } from '../ab-variants.mjs';

describe('hashToInt', () => {
  it('returns a non-negative 32-bit integer', () => {
    const hash = hashToInt('test@example.com');
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it('is stable for the same input', () => {
    expect(hashToInt('hello')).toBe(hashToInt('hello'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToInt('a')).not.toBe(hashToInt('b'));
  });

  it('matches the known FNV-1a 32-bit value for a fixed string', () => {
    // Canonical FNV-1a 32-bit hash of "hello".
    expect(hashToInt('hello')).toBe(0x4f9f2cab);
  });
});

describe('pickVariant', () => {
  it('returns only "a" or "b"', () => {
    const variant = pickVariant('user@example.com', 'tenant_1');
    expect(['a', 'b']).toContain(variant);
  });

  it('is deterministic for the same email + seed across calls', () => {
    const first = pickVariant('user@example.com', 'tenant_1');
    const second = pickVariant('user@example.com', 'tenant_1');
    const third = pickVariant('user@example.com', 'tenant_1');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('produces both buckets across a set of emails', () => {
    const variants = new Set();
    for (let i = 0; i < 200; i++) {
      variants.add(pickVariant(`user${i}@example.com`, 'seed'));
    }
    expect(variants.has('a')).toBe(true);
    expect(variants.has('b')).toBe(true);
  });

  it('can change assignment when the seed changes', () => {
    // Find at least one email whose variant differs between two seeds.
    let changed = false;
    for (let i = 0; i < 500 && !changed; i++) {
      const email = `user${i}@example.com`;
      if (pickVariant(email, 'seedA') !== pickVariant(email, 'seedB')) {
        changed = true;
      }
    }
    expect(changed).toBe(true);
  });
});

describe('splitRecipients', () => {
  const emails = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];

  it('returns buckets keyed a and b', () => {
    const result = splitRecipients(emails, 'seed');
    expect(result).toHaveProperty('a');
    expect(result).toHaveProperty('b');
    expect(Array.isArray(result.a)).toBe(true);
    expect(Array.isArray(result.b)).toBe(true);
  });

  it('partitions completely with no overlap', () => {
    const { a, b } = splitRecipients(emails, 'seed');
    expect(a.length + b.length).toBe(emails.length);

    const combined = new Set([...a, ...b]);
    expect(combined.size).toBe(emails.length);
    for (const email of emails) {
      expect(combined.has(email)).toBe(true);
    }

    // No email appears in both buckets.
    for (const email of a) {
      expect(b).not.toContain(email);
    }
  });

  it('preserves input order within each bucket', () => {
    const { a, b } = splitRecipients(emails, 'seed');

    const expectedA = emails.filter((e) => pickVariant(e, 'seed') === 'a');
    const expectedB = emails.filter((e) => pickVariant(e, 'seed') === 'b');

    expect(a).toEqual(expectedA);
    expect(b).toEqual(expectedB);
  });

  it('assigns each recipient consistently with pickVariant', () => {
    const { a, b } = splitRecipients(emails, 'seed');
    for (const email of a) {
      expect(pickVariant(email, 'seed')).toBe('a');
    }
    for (const email of b) {
      expect(pickVariant(email, 'seed')).toBe('b');
    }
  });

  it('handles empty / nullish input gracefully', () => {
    expect(splitRecipients([], 'seed')).toEqual({ a: [], b: [] });
    expect(splitRecipients(undefined, 'seed')).toEqual({ a: [], b: [] });
  });

  it('produces a roughly 50/50 distribution over many emails', () => {
    const many = [];
    for (let i = 0; i < 600; i++) {
      many.push(`subscriber${i}@newsletter.test`);
    }
    const { a, b } = splitRecipients(many, 'issue_42');

    const fractionA = a.length / many.length;
    // Allow a generous tolerance band around 50%.
    expect(fractionA).toBeGreaterThanOrEqual(0.35);
    expect(fractionA).toBeLessThanOrEqual(0.65);
  });
});
