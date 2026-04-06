import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { filterSponsors } from '../sponsorService';
import type { SponsorRecord } from '../sponsorService';

/**
 * **Validates: Requirements 5.3**
 *
 * Property 15: Sponsor search filtering
 *
 * For any search query string q and list of SponsorRecords, the filtered results
 * shall contain exactly those sponsors where q appears as a case-insensitive
 * substring of sponsorName, contactName, or contactEmail. No sponsor that does
 * not match any of these fields shall appear in the results.
 */

// Arbitrary for generating a minimal valid SponsorRecord
const sponsorRecordArb: fc.Arbitrary<SponsorRecord> = fc.record({
  sponsorId: fc.uuid(),
  sponsorName: fc.string({ minLength: 0, maxLength: 40 }),
  shortDescription: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  longDescription: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  logoUrl: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  contactName: fc.option(fc.string({ minLength: 0, maxLength: 30 }), { nil: undefined }),
  contactEmail: fc.string({ minLength: 1, maxLength: 30 }),
  notes: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  status: fc.constantFrom('active', 'archived'),
  version: fc.integer({ min: 1, max: 100 }),
  totalFulfilledSponsorships: fc.integer({ min: 0, max: 100 }),
  totalRevenue: fc.double({ min: 0, max: 100000, noNaN: true }),
  lastSponsoredDate: fc.option(fc.constant('2025-01-15'), { nil: undefined }),
  lastOutreachAt: fc.option(fc.constant('2025-01-15T10:00:00Z'), { nil: undefined }),
  createdAt: fc.constant('2025-01-01T00:00:00Z'),
  updatedAt: fc.constant('2025-01-01T00:00:00Z'),
  archivedAt: fc.option(fc.constant('2025-01-10T00:00:00Z'), { nil: undefined }),
});

describe('Property 15: Sponsor search filtering', () => {
  it('every result contains the query as a case-insensitive substring in sponsorName, contactName, or contactEmail', () => {
    fc.assert(
      fc.property(
        fc.array(sponsorRecordArb, { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 15 }),
        (sponsors, query) => {
          const results = filterSponsors(sponsors, query);
          const q = query.toLowerCase().trim();

          if (!q) {
            // Empty/whitespace-only query returns all sponsors
            expect(results).toHaveLength(sponsors.length);
            return;
          }

          // Every result must match on at least one field
          for (const sponsor of results) {
            const nameMatch = sponsor.sponsorName?.toLowerCase().includes(q) ?? false;
            const contactMatch = sponsor.contactName?.toLowerCase().includes(q) ?? false;
            const emailMatch = sponsor.contactEmail?.toLowerCase().includes(q) ?? false;
            expect(nameMatch || contactMatch || emailMatch).toBe(true);
          }
        }
      )
    );
  });

  it('no sponsor that should match is excluded from the results', () => {
    fc.assert(
      fc.property(
        fc.array(sponsorRecordArb, { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 15 }),
        (sponsors, query) => {
          const results = filterSponsors(sponsors, query);
          const q = query.toLowerCase().trim();

          if (!q) return;

          // Compute expected matches independently
          const expected = sponsors.filter((s) => {
            const name = s.sponsorName?.toLowerCase() ?? '';
            const contact = s.contactName?.toLowerCase() ?? '';
            const email = s.contactEmail?.toLowerCase() ?? '';
            return name.includes(q) || contact.includes(q) || email.includes(q);
          });

          // Results must contain exactly the expected sponsors
          expect(results).toHaveLength(expected.length);
          for (const sponsor of expected) {
            expect(results).toContainEqual(sponsor);
          }
        }
      )
    );
  });
});
