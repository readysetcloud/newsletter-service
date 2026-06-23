/**
 * Deterministic A/B variant assignment utilities (A/B Testing Phase 1).
 *
 * Pure, dependency-free module: no crypto, no AWS SDK, no runtime deps.
 * Variant assignment is stable across processes so the same recipient always
 * lands in the same bucket for a given seed (the issue's referenceNumber).
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Stable FNV-1a 32-bit hash of a string, returned as a non-negative integer.
 *
 * @param {string} value - String to hash.
 * @returns {number} Non-negative 32-bit integer hash.
 */
export const hashToInt = (value) => {
  const str = String(value ?? '');
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiply by the FNV prime using 32-bit overflow semantics.
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Coerce to an unsigned 32-bit integer so the result is always non-negative.
  return hash >>> 0;
};

/**
 * Deterministically pick a variant ("a" or "b") for a given email + seed.
 *
 * Same inputs always produce the same output, across processes. The split is
 * approximately 50/50 over a realistic set of email addresses.
 *
 * @param {string} email - Recipient email address.
 * @param {string} seed - Stable seed (the issue's referenceNumber).
 * @returns {"a" | "b"} The assigned variant id.
 */
export const pickVariant = (email, seed) => {
  const hash = hashToInt(`${seed}:${email}`);
  return (hash & 1) === 0 ? 'a' : 'b';
};

/**
 * Split recipients into deterministic A/B buckets using {@link pickVariant}.
 *
 * Input order is preserved within each bucket.
 *
 * @param {string[]} emails - Recipient email addresses.
 * @param {string} seed - Stable seed (the issue's referenceNumber).
 * @returns {{ a: string[], b: string[] }} Recipients partitioned by variant.
 */
export const splitRecipients = (emails, seed) => {
  const buckets = { a: [], b: [] };

  for (const email of emails ?? []) {
    buckets[pickVariant(email, seed)].push(email);
  }

  return buckets;
};
