import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { PricingRecord } from '@/types/pricing';
import type { ReportData } from '@/types/report';
import { extractTrendData } from '@/services/reportService';

// Feature: sponsor-export-report, Property 3: Trend data bounded to 12 records
describe('Property 3: Trend data bounded to 12 records', () => {
  it('extractTrendData returns min(N, 12) entries from the most recent records', () => {

    const pricingRecordArb: fc.Arbitrary<PricingRecord> = fc.record({
      recommendedPrice: fc.double({ min: 0.01, max: 10_000, noNaN: true }),
      baselinePrice: fc.double({ min: 0.01, max: 10_000, noNaN: true }),
      multiplier: fc.record({
        raw: fc.double({ min: 0, max: 10, noNaN: true }),
        clamped: fc.double({ min: 0, max: 10, noNaN: true }),
        smoothed: fc.double({ min: 0, max: 10, noNaN: true }),
      }),
      confidence: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
      justification: fc.string({ minLength: 1, maxLength: 50 }),
      metrics: fc.record({
        subscriberCount: fc.integer({ min: 0, max: 1_000_000 }),
        avgOpenRate: fc.double({ min: 0, max: 1, noNaN: true }),
        avgClickRate: fc.double({ min: 0, max: 1, noNaN: true }),
        avgBounceRate: fc.double({ min: 0, max: 1, noNaN: true }),
        avgComplaintRate: fc.double({ min: 0, max: 0.1, noNaN: true }),
        subscriberGrowthRate: fc.double({ min: -1, max: 1, noNaN: true }),
        publishedIssueCount: fc.integer({ min: 0, max: 500 }),
      }),
      calculatedAt: fc.constant('2025-01-15T00:00:00Z'),
      metricsAsOf: fc.constant('2025-01-14T00:00:00Z'),
      weekWindow: fc.constant('2025-W03'),
      isFallback: fc.boolean(),
      smoothingApplied: fc.boolean(),
    });

    fc.assert(
      fc.property(
        fc.array(pricingRecordArb, { minLength: 0, maxLength: 52 }),
        (records) => {
          const result = extractTrendData(records);

          // Output length should be min(N, 12)
          const expectedLength = Math.min(records.length, 12);
          expect(result).toHaveLength(expectedLength);

          // Entries should come from the most recent (last) records
          const recentRecords = records.slice(-12);
          for (let i = 0; i < result.length; i++) {
            expect(result[i].recommendedPrice).toBe(recentRecords[i].recommendedPrice);
            expect(result[i].subscriberCount).toBe(recentRecords[i].metrics.subscriberCount);
            expect(result[i].date).toBe(recentRecords[i].calculatedAt);
          }
        }
      )
    );
  });
});


// Feature: sponsor-export-report, Property 10: Report data excludes sensitive fields
vi.mock('@/services/pricingService', () => ({
  pricingService: {
    getPricing: vi.fn(),
    getPricingHistory: vi.fn(),
    generateNarrative: vi.fn(),
  },
}));

vi.mock('@/services/profileService', () => ({
  profileService: {
    getProfile: vi.fn(),
  },
}));

describe('Property 10: Report data excludes sensitive fields', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('assembled ReportData does not contain sensitive fields', async () => {
    const { pricingService } = await import('@/services/pricingService');
    const { profileService } = await import('@/services/profileService');
    const { reportService } = await import('@/services/reportService');

    const pricingRecordArb: fc.Arbitrary<PricingRecord> = fc.record({
      recommendedPrice: fc.double({ min: 0.01, max: 10_000, noNaN: true }),
      baselinePrice: fc.double({ min: 0.01, max: 10_000, noNaN: true }),
      multiplier: fc.record({
        raw: fc.double({ min: 0, max: 10, noNaN: true }),
        clamped: fc.double({ min: 0, max: 10, noNaN: true }),
        smoothed: fc.double({ min: 0, max: 10, noNaN: true }),
      }),
      confidence: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
      justification: fc.string({ minLength: 1, maxLength: 100 }),
      metrics: fc.record({
        subscriberCount: fc.integer({ min: 1, max: 1_000_000 }),
        avgOpenRate: fc.double({ min: 0.01, max: 1, noNaN: true }),
        avgClickRate: fc.double({ min: 0, max: 1, noNaN: true }),
        avgBounceRate: fc.double({ min: 0, max: 1, noNaN: true }),
        avgComplaintRate: fc.double({ min: 0, max: 0.1, noNaN: true }),
        subscriberGrowthRate: fc.double({ min: -1, max: 1, noNaN: true }),
        publishedIssueCount: fc.integer({ min: 0, max: 500 }),
      }),
      calculatedAt: fc.constant('2025-01-15T00:00:00Z'),
      metricsAsOf: fc.constant('2025-01-14T00:00:00Z'),
      weekWindow: fc.constant('2025-W03'),
      isFallback: fc.boolean(),
      smoothingApplied: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(pricingRecordArb, async (record) => {
        // Add questionnaireResponses to the record
        const recordWithQuestionnaire = {
          ...record,
          questionnaireResponses: { q1: 'answer1', q2: 'answer2' },
        };

        vi.mocked(pricingService.getPricing).mockResolvedValue({
          success: true,
          data: {
            current: recordWithQuestionnaire,
            hasPricing: true,
            firstCalculationPending: false,
          },
        });

        vi.mocked(pricingService.getPricingHistory).mockResolvedValue({
          success: true,
          data: { history: [recordWithQuestionnaire], count: 1 },
        });

        vi.mocked(pricingService.generateNarrative).mockResolvedValue({
          success: false,
          error: 'not available',
        });

        vi.mocked(profileService.getProfile).mockResolvedValue({
          success: true,
          data: {
            userId: 'user-1',
            email: 'test@example.com',
            brand: { brandName: 'Test Brand', industry: 'tech' },
            profile: { firstName: 'Test', lastName: 'User' },
            preferences: { timezone: 'UTC' },
            lastModified: '2025-01-01T00:00:00Z',
          },
        });

        const reportData: ReportData = await reportService.assembleReportData();
        const serialized = JSON.stringify(reportData);

        // Sensitive fields must not appear in the report data
        expect(serialized).not.toContain('"bounceRate"');
        expect(serialized).not.toContain('"avgBounceRate"');
        expect(serialized).not.toContain('"complaintRate"');
        expect(serialized).not.toContain('"avgComplaintRate"');
        expect(serialized).not.toContain('"multiplier"');
        expect(serialized).not.toContain('"raw"');
        expect(serialized).not.toContain('"clamped"');
        expect(serialized).not.toContain('"smoothed"');
        expect(serialized).not.toContain('"justification"');
        expect(serialized).not.toContain('"baselinePrice"');
        expect(serialized).not.toContain('"questionnaireResponses"');

        // Verify the report still has the expected public fields
        expect(reportData.recommendedPrice).toBe(record.recommendedPrice);
        expect(reportData.subscriberCount).toBe(record.metrics.subscriberCount);
        expect(reportData.avgOpenRate).toBe(record.metrics.avgOpenRate);
        expect(reportData.avgClickRate).toBe(record.metrics.avgClickRate);
      }),
      { numRuns: 20 } // Reduced runs since each iteration involves async mocking
    );
  });
});
