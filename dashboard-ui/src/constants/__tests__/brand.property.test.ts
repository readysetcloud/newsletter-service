/**
 * Storage Key Prefix Consistency
 *
 * Validates: Requirements 3.1, 3.2 (Invariant 2)
 */

import { describe, it, expect } from 'vitest';
import { BRAND, STORAGE_KEYS } from '../brand';

describe('Storage key prefix consistency', () => {
  it('all STORAGE_KEYS start with BRAND.storageKeyPrefix followed by a hyphen', () => {
    const expectedStart = `${BRAND.storageKeyPrefix}-`;

    for (const value of Object.values(STORAGE_KEYS)) {
      expect(value.startsWith(expectedStart)).toBe(true);
    }
  });

  it('BRAND.storageKeyPrefix is non-empty', () => {
    expect(BRAND.storageKeyPrefix.length).toBeGreaterThan(0);
  });
});
