import fc from 'fast-check';
import { filterEligibleTenants } from '../weekly-pricing-job.mjs';

// Feature: sponsorship-pricing-calculator, Property 10: Tenant eligibility for weekly pricing job
describe('Property 10: Tenant eligibility for weekly pricing job', () => {
  // **Validates: Requirements 2.2**

  /**
   * Generator for a single issue object with random status and statsPhase.
   */
  const issueArb = fc.record({
    status: fc.constantFrom('published', 'draft', 'scheduled', 'archived'),
    statsPhase: fc.constantFrom('consolidated', 'aggregating', 'pending', 'none')
  });

  /**
   * Generator for a single tenant with 0-5 issues and 0-1000 subscribers.
   */
  const tenantArb = fc.record({
    tenantId: fc.uuid(),
    issues: fc.array(issueArb, { minLength: 0, maxLength: 5 }),
    subscriberCount: fc.integer({ min: 0, max: 1000 })
  });

  it('selects exactly tenants with ≥1 Published_Issue_With_Analytics AND subscriber count > 0', () => {
    fc.assert(
      fc.property(
        fc.array(tenantArb, { minLength: 0, maxLength: 50 }),
        (tenants) => {
          const result = filterEligibleTenants(tenants);

          // Compute expected eligible set independently
          const expected = tenants.filter((t) => {
            const hasAnalytics = t.issues.some(
              (i) => i.status === 'published' && i.statsPhase === 'consolidated'
            );
            return hasAnalytics && t.subscriberCount > 0;
          });

          // Same length
          expect(result.length).toBe(expected.length);

          // Same tenant IDs in the same order
          const resultIds = result.map((t) => t.tenantId);
          const expectedIds = expected.map((t) => t.tenantId);
          expect(resultIds).toEqual(expectedIds);

          // Every returned tenant satisfies both criteria
          for (const tenant of result) {
            expect(tenant.subscriberCount).toBeGreaterThan(0);
            expect(
              tenant.issues.some(
                (i) => i.status === 'published' && i.statsPhase === 'consolidated'
              )
            ).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns empty array when no tenants meet criteria', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tenantId: fc.uuid(),
            issues: fc.array(
              fc.record({
                status: fc.constantFrom('draft', 'scheduled', 'archived'),
                statsPhase: fc.constantFrom('aggregating', 'pending', 'none')
              }),
              { minLength: 0, maxLength: 5 }
            ),
            subscriberCount: fc.constant(0)
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (tenants) => {
          const result = filterEligibleTenants(tenants);
          expect(result.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tenants with published+consolidated issues but zero subscribers are excluded', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tenantId: fc.uuid(),
            issues: fc.constant([{ status: 'published', statsPhase: 'consolidated' }]),
            subscriberCount: fc.constant(0)
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (tenants) => {
          const result = filterEligibleTenants(tenants);
          expect(result.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tenants with subscribers but no published+consolidated issues are excluded', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tenantId: fc.uuid(),
            issues: fc.array(
              fc.record({
                status: fc.constantFrom('draft', 'scheduled'),
                statsPhase: fc.constantFrom('pending', 'none')
              }),
              { minLength: 0, maxLength: 5 }
            ),
            subscriberCount: fc.integer({ min: 1, max: 1000 })
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (tenants) => {
          const result = filterEligibleTenants(tenants);
          expect(result.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
