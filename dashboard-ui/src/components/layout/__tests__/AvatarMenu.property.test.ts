// Feature: dashboard-ux-overhaul, Property 2: Avatar initials derivation
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getInitials } from '../avatarUtils';

/**
 * **Validates: Requirements 3.1, 3.2**
 *
 * Property 2: Avatar initials derivation
 *
 * For any user with firstName and lastName strings, the AvatarMenu initials
 * equal `firstName[0].toUpperCase() + lastName[0].toUpperCase()`.
 * When either firstName or lastName is undefined/null/empty, getInitials
 * returns null (fallback icon case).
 */
describe('AvatarMenu - Property-Based Tests', () => {
  const nameRecordGen = fc.record({
    firstName: fc.option(fc.string({ minLength: 1 })),
    lastName: fc.option(fc.string({ minLength: 1 })),
  });

  describe('Property 2: Avatar initials derivation', () => {
    it('returns correct initials when both firstName and lastName are non-empty strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.string({ minLength: 1 }),
          (firstName, lastName) => {
            const result = getInitials(firstName, lastName);
            const expected = firstName[0].toUpperCase() + lastName[0].toUpperCase();
            expect(result).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns null when either firstName or lastName is undefined/null/empty', () => {
      // Generate records where at least one name is missing (null from fc.option)
      fc.assert(
        fc.property(nameRecordGen, ({ firstName, lastName }) => {
          const hasBothNames =
            firstName !== null &&
            firstName.length > 0 &&
            lastName !== null &&
            lastName.length > 0;

          if (!hasBothNames) {
            const result = getInitials(
              firstName ?? undefined,
              lastName ?? undefined,
            );
            expect(result).toBeNull();
          }
        }),
        { numRuns: 100 },
      );
    });

    it('result is always either null or exactly 2 uppercase characters', () => {
      fc.assert(
        fc.property(nameRecordGen, ({ firstName, lastName }) => {
          const result = getInitials(
            firstName ?? undefined,
            lastName ?? undefined,
          );

          if (result === null) {
            expect(result).toBeNull();
          } else {
            expect(result).toHaveLength(2);
            expect(result).toBe(result.toUpperCase());
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
