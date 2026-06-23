/**
 * Unit tests for deterministic A/B variant assignment utilities.
 */

import {
  hashToInt,
  pickVariant,
  splitRecipients,
  selectHoldoutSample
} from '../ab-variants.mjs';

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

describe('selectHoldoutSample', () => {
  const buildEmails = (n, prefix = 'subscriber') => {
    const emails = [];
    for (let i = 0; i < n; i++) {
      emails.push(`${prefix}${i}@newsletter.test`);
    }
    return emails;
  };

  it('returns sample and holdout arrays', () => {
    const result = selectHoldoutSample(['a@x.com', 'b@x.com'], 'seed', 0.5);
    expect(result).toHaveProperty('sample');
    expect(result).toHaveProperty('holdout');
    expect(Array.isArray(result.sample)).toBe(true);
    expect(Array.isArray(result.holdout)).toBe(true);
  });

  it('is deterministic: same membership across repeated calls', () => {
    const emails = buildEmails(300);
    const first = selectHoldoutSample(emails, 'issue_42', 0.2);
    const second = selectHoldoutSample(emails, 'issue_42', 0.2);
    const third = selectHoldoutSample(emails, 'issue_42', 0.2);

    expect(second.sample).toEqual(first.sample);
    expect(second.holdout).toEqual(first.holdout);
    expect(third.sample).toEqual(first.sample);
    expect(third.holdout).toEqual(first.holdout);
  });

  it('produces a complete partition with no overlap and preserves order', () => {
    const emails = buildEmails(300);
    const { sample, holdout } = selectHoldoutSample(emails, 'issue_42', 0.3);

    // Complete partition.
    expect(sample.length + holdout.length).toBe(emails.length);
    const combined = new Set([...sample, ...holdout]);
    expect(combined.size).toBe(emails.length);
    for (const email of emails) {
      expect(combined.has(email)).toBe(true);
    }

    // No overlap.
    const holdoutSet = new Set(holdout);
    for (const email of sample) {
      expect(holdoutSet.has(email)).toBe(false);
    }

    // Order preserved within each partition (matches input filter order).
    expect(sample).toEqual(emails.filter((e) => sample.includes(e)));
    expect(holdout).toEqual(emails.filter((e) => holdout.includes(e)));
  });

  it('yields roughly testFraction of the list (~20%)', () => {
    const emails = buildEmails(400);
    const { sample } = selectHoldoutSample(emails, 'issue_42', 0.2);

    const fraction = sample.length / emails.length;
    // Tolerance band around 20%.
    expect(fraction).toBeGreaterThanOrEqual(0.12);
    expect(fraction).toBeLessThanOrEqual(0.28);
  });

  it('puts everyone in the sample when testFraction >= 1 (empty hold-out)', () => {
    const emails = buildEmails(50);
    const { sample, holdout } = selectHoldoutSample(emails, 'seed', 1);
    expect(sample).toEqual(emails);
    expect(holdout).toEqual([]);

    const over = selectHoldoutSample(emails, 'seed', 1.5);
    expect(over.sample).toEqual(emails);
    expect(over.holdout).toEqual([]);
  });

  it('puts no one in the sample when testFraction <= 0', () => {
    const emails = buildEmails(50);
    const zero = selectHoldoutSample(emails, 'seed', 0);
    expect(zero.sample).toEqual([]);
    expect(zero.holdout).toEqual(emails);

    const negative = selectHoldoutSample(emails, 'seed', -0.5);
    expect(negative.sample).toEqual([]);
    expect(negative.holdout).toEqual(emails);
  });

  it('handles empty / nullish input gracefully', () => {
    expect(selectHoldoutSample([], 'seed', 0.2)).toEqual({ sample: [], holdout: [] });
    expect(selectHoldoutSample(undefined, 'seed', 0.2)).toEqual({ sample: [], holdout: [] });
    expect(selectHoldoutSample(null, 'seed', 0.2)).toEqual({ sample: [], holdout: [] });
  });

  it('sample membership is independent of pickVariant assignment', () => {
    const emails = buildEmails(600);
    const { sample } = selectHoldoutSample(emails, 'issue_42', 0.5);

    // Among the sample, both variants should still appear, demonstrating the
    // distinct seed suffix decouples sampling from variant assignment.
    const variants = new Set(sample.map((e) => pickVariant(e, 'issue_42')));
    expect(variants.has('a')).toBe(true);
    expect(variants.has('b')).toBe(true);

    // The set of sampled emails differs from a naive "variant a" partition,
    // i.e. sampling is not just re-deriving the variant split.
    const variantA = new Set(emails.filter((e) => pickVariant(e, 'issue_42') === 'a'));
    const sampleSet = new Set(sample);
    let differs = false;
    for (const email of emails) {
      if (sampleSet.has(email) !== variantA.has(email)) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});
