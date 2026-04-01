import { describe, it, expect } from 'vitest';
import {
  formatSubscriberCount,
  formatPercentage,
  formatSignedPercentage,
  formatCurrency,
  formatImpressionsEstimate,
  formatReportDate,
  computeImpressionsEstimate,
  mapConfidenceLabel,
  generateGrowthSummary,
  generateFilename,
  generateTemplateNarrative,
} from '../reportFormatters';
import type { TrendPoint } from '../reportFormatters';
import fc from 'fast-check';
import type { BrandInfo } from '@/types';

describe('reportFormatters', () => {
  describe('formatSubscriberCount', () => {
    it('formats with thousands separators', () => {
      expect(formatSubscriberCount(12500)).toBe('12,500');
    });
    it('handles zero', () => {
      expect(formatSubscriberCount(0)).toBe('0');
    });
    it('handles small numbers', () => {
      expect(formatSubscriberCount(42)).toBe('42');
    });
    it('handles large numbers', () => {
      expect(formatSubscriberCount(1000000)).toBe('1,000,000');
    });
  });

  describe('formatPercentage', () => {
    it('formats decimal as percentage with one decimal', () => {
      expect(formatPercentage(0.483)).toBe('48.3%');
    });
    it('handles zero', () => {
      expect(formatPercentage(0)).toBe('0.0%');
    });
    it('handles 100%', () => {
      expect(formatPercentage(1)).toBe('100.0%');
    });
  });

  describe('formatSignedPercentage', () => {
    it('formats positive with + sign', () => {
      expect(formatSignedPercentage(0.052)).toBe('+5.2%');
    });
    it('formats negative with - sign', () => {
      expect(formatSignedPercentage(-0.013)).toBe('-1.3%');
    });
    it('formats zero as +0.0%', () => {
      expect(formatSignedPercentage(0)).toBe('+0.0%');
    });
  });

  describe('formatCurrency', () => {
    it('formats as USD with two decimals', () => {
      expect(formatCurrency(150)).toBe('$150.00');
    });
    it('handles zero', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });
    it('handles large amounts with thousands separators', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });
  });

  describe('formatImpressionsEstimate', () => {
    it('formats with thousands separators', () => {
      expect(formatImpressionsEstimate(6000)).toBe('6,000');
    });
  });

  describe('formatReportDate', () => {
    it('formats ISO string as MMM DD, YYYY', () => {
      expect(formatReportDate('2025-01-15T00:00:00Z')).toBe('Jan 15, 2025');
    });
    it('handles different months', () => {
      expect(formatReportDate('2025-12-25T12:00:00Z')).toBe('Dec 25, 2025');
    });
  });

  describe('computeImpressionsEstimate', () => {
    it('multiplies subscriber count by open rate', () => {
      expect(computeImpressionsEstimate(10000, 0.5)).toBe(5000);
    });
    it('handles zero subscribers', () => {
      expect(computeImpressionsEstimate(0, 0.5)).toBe(0);
    });
    it('handles zero open rate', () => {
      expect(computeImpressionsEstimate(10000, 0)).toBe(0);
    });
  });

  describe('mapConfidenceLabel', () => {
    it('maps high confidence', () => {
      expect(mapConfidenceLabel('high')).toBe('Based on consistent engagement and stable growth');
    });
    it('maps medium confidence', () => {
      expect(mapConfidenceLabel('medium')).toBe('Based on moderate engagement with developing trends');
    });
    it('maps low confidence', () => {
      expect(mapConfidenceLabel('low')).toBe('Based on early data with limited history');
    });
  });

  describe('generateGrowthSummary', () => {
    const makeTrend = (prices: number[]): TrendPoint[] =>
      prices.map((p, i) => ({ date: `2025-01-${i + 1}`, recommendedPrice: p, subscriberCount: 1000 }));

    it('reports growth when change > 2%', () => {
      expect(generateGrowthSummary(makeTrend([100, 112]), 12)).toBe('+12% growth over last 12 weeks');
    });
    it('reports stable when change within +/-2%', () => {
      expect(generateGrowthSummary(makeTrend([100, 101]), 12)).toBe('Stable pricing over last 12 weeks');
    });
    it('reports decline when change < -2%', () => {
      const expected = '-10% over last 12 weeks \u2014 recent decline with opportunity for recovery';
      expect(generateGrowthSummary(makeTrend([100, 90]), 12)).toBe(expected);
    });
    it('reports stable for single data point', () => {
      expect(generateGrowthSummary(makeTrend([100]), 1)).toBe('Stable pricing over last 1 weeks');
    });
  });

  describe('generateFilename', () => {
    it('generates correct filename pattern', () => {
      expect(generateFilename('My Newsletter', new Date(2025, 0, 15))).toBe('my-newsletter-sponsor-report-2025-01-15.pdf');
    });
    it('sanitizes special characters', () => {
      expect(generateFilename('Caf\u00e9 & Code!', new Date(2025, 0, 15))).toBe('caf-code-sponsor-report-2025-01-15.pdf');
    });
  });

  describe('generateTemplateNarrative', () => {
    it('generates narrative with name, industry, and description', () => {
      const result = generateTemplateNarrative({
        brandName: 'Tech Weekly',
        industry: 'technology',
        brandDescription: 'Covering the latest in tech.',
      });
      expect(result).toBe('Tech Weekly is a technology newsletter. Covering the latest in tech.');
    });
    it('generates narrative without description', () => {
      const result = generateTemplateNarrative({
        brandName: 'Tech Weekly',
        industry: 'technology',
      });
      expect(result).toBe('Tech Weekly is a technology newsletter.');
    });
    it('generates narrative with only name', () => {
      const result = generateTemplateNarrative({ brandName: 'Tech Weekly' });
      expect(result).toBe('Tech Weekly is a newsletter.');
    });
    it('does not include metric values', () => {
      const result = generateTemplateNarrative({
        brandName: 'Tech Weekly',
        industry: 'technology',
        brandDescription: 'A great newsletter.',
      });
      expect(result).not.toMatch(/\d+%/);
      expect(result).not.toMatch(/\$\d/);
    });
  });
});


describe('Property-based tests', () => {
  // Feature: sponsor-export-report, Property 1: Filename generation pattern
  // **Validates: Requirements 1.6**
  it('Property 1: generateFilename produces valid pattern for any brand name and date', () => {
    const hasAlphanumeric = /[a-zA-Z0-9]/;
    const validPrefix = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    const datePattern = /-sponsor-report-(\d{4})-(\d{2})-(\d{2})\.pdf$/;

    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => hasAlphanumeric.test(s)),
        fc.integer({ min: 2000, max: 2099 }).chain(y =>
          fc.integer({ min: 1, max: 12 }).chain(m =>
            fc.integer({ min: 1, max: 28 }).map(d => new Date(y, m - 1, d))
          )
        ),
        (brandName, date) => {
          const result = generateFilename(brandName, date);

          // Must end with .pdf
          expect(result.endsWith('.pdf')).toBe(true);

          // Must contain -sponsor-report- followed by YYYY-MM-DD
          const dateMatch = result.match(datePattern);
          expect(dateMatch).not.toBeNull();

          // The normalized prefix should only contain lowercase a-z, 0-9, and hyphens
          const prefix = result.replace(datePattern, '');
          expect(prefix).toMatch(validPrefix);

          // Date portion should match the input date
          expect(Number(dateMatch![1])).toBe(date.getFullYear());
          expect(Number(dateMatch![2])).toBe(date.getMonth() + 1);
          expect(Number(dateMatch![3])).toBe(date.getDate());
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 2: Impressions estimate computation
  // **Validates: Requirements 2.8**
  it('Property 2: computeImpressionsEstimate equals subscriberCount * avgOpenRate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (subscriberCount, avgOpenRate) => {
          const result = computeImpressionsEstimate(subscriberCount, avgOpenRate);
          expect(result).toBe(subscriberCount * avgOpenRate);
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 5: Thousands separator formatting
  // **Validates: Requirements 4.1, 4.8**
  it('Property 5: formatSubscriberCount groups digits in threes with commas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }),
        (n) => {
          const result = formatSubscriberCount(n);

          // Parsing back by removing commas should yield the original number
          const parsed = Number(result.replace(/,/g, ''));
          expect(parsed).toBe(n);

          // Digits should be grouped in threes from the right
          const parts = result.split(',');
          if (parts.length > 1) {
            expect(parts[0]).toMatch(/^\d{1,3}$/);
            for (let i = 1; i < parts.length; i++) {
              expect(parts[i]).toMatch(/^\d{3}$/);
            }
          } else {
            expect(parts[0]).toMatch(/^\d{1,3}$/);
          }
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 6: Percentage formatting
  // **Validates: Requirements 4.2**
  it('Property 6: formatPercentage produces X.Y% with correct rounding', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        (rate) => {
          const result = formatPercentage(rate);

          // Must match X.Y% pattern (one or more digits, dot, one digit, percent)
          expect(result).toMatch(/^\d+\.\d%$/);

          // The numeric value should be correctly rounded
          const numericPart = parseFloat(result.replace('%', ''));
          const expected = parseFloat((rate * 100).toFixed(1));
          expect(numericPart).toBe(expected);
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 7: Signed percentage formatting
  // **Validates: Requirements 4.3**
  it('Property 7: formatSignedPercentage has correct sign, one decimal, trailing %', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        (rate) => {
          const result = formatSignedPercentage(rate);

          // Must end with %
          expect(result.endsWith('%')).toBe(true);

          // Must have one decimal place before %
          expect(result).toMatch(/\.\d%$/);

          // Positive or zero should have leading +
          if (rate >= 0) {
            expect(result.startsWith('+')).toBe(true);
          }
          // Negative should have leading -
          if (rate < 0) {
            expect(result.startsWith('-')).toBe(true);
          }

          // Parsing the numeric portion should recover the value to one decimal
          const numStr = result.replace('%', '').replace('+', '');
          const parsed = parseFloat(numStr);
          const expected = parseFloat((rate * 100).toFixed(1));
          expect(parsed).toBe(expected);
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 8: Currency formatting
  // **Validates: Requirements 4.4**
  it('Property 8: formatCurrency starts with $, has two decimal places and thousands separators', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        (amount) => {
          const result = formatCurrency(amount);

          // Must start with $
          expect(result.startsWith('$')).toBe(true);

          // Must have exactly two decimal places
          expect(result).toMatch(/\.\d{2}$/);

          // The integer part should have proper thousands separators
          const withoutDollar = result.slice(1);
          const dotIndex = withoutDollar.indexOf('.');
          const intPart = withoutDollar.slice(0, dotIndex);
          const decPart = withoutDollar.slice(dotIndex + 1);
          expect(decPart).toHaveLength(2);

          // Verify thousands separator grouping in integer part
          const intGroups = intPart.split(',');
          if (intGroups.length > 1) {
            expect(intGroups[0]).toMatch(/^\d{1,3}$/);
            for (let i = 1; i < intGroups.length; i++) {
              expect(intGroups[i]).toMatch(/^\d{3}$/);
            }
          }
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 9: Date formatting round-trip consistency
  // **Validates: Requirements 4.5**
  it('Property 9: formatReportDate produces MMM DD, YYYY matching the same calendar day', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2030 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (year, month, day) => {
          const iso = year.toString() + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') + 'T12:00:00Z';
          const result = formatReportDate(iso);

          // Must match "MMM DD, YYYY" pattern
          const mmmDdYyyy = /^[A-Z][a-z]{2} \d{2}, \d{4}$/;
          expect(result).toMatch(mmmDdYyyy);

          // Parse the output and verify it represents the same calendar day (UTC)
          const parts = result.split(' ');
          const monthAbbr = parts[0];
          const dayStr = parts[1].replace(',', '');
          const yearStr = parts[2];

          expect(months.indexOf(monthAbbr)).toBe(month - 1);
          expect(Number(dayStr)).toBe(day);
          expect(Number(yearStr)).toBe(year);
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 4: Growth summary derivation
  // **Validates: Requirements 3.6**
  it('Property 4: generateGrowthSummary categorizes correctly based on +/-2% threshold', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            date: fc.integer({ min: 2020, max: 2030 }).chain(y =>
              fc.integer({ min: 1, max: 12 }).chain(m =>
                fc.integer({ min: 1, max: 28 }).map(d =>
                  y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') + 'T00:00:00Z'
                )
              )
            ),
            recommendedPrice: fc.double({ min: 0.01, max: 10_000, noNaN: true }),
            subscriberCount: fc.integer({ min: 0, max: 1_000_000 }),
          }),
          { minLength: 2, maxLength: 12 }
        ),
        (trendData) => {
          const weeks = trendData.length;
          const result = generateGrowthSummary(trendData, weeks);

          const first = trendData[0];
          const last = trendData[trendData.length - 1];
          const change = (last.recommendedPrice - first.recommendedPrice) / first.recommendedPrice;
          const pct = Math.abs(Math.round(change * 100));

          if (change > 0.02) {
            expect(result).toBe('+' + pct + '% growth over last ' + weeks + ' weeks');
          } else if (change < -0.02) {
            expect(result).toBe('-' + pct + '% over last ' + weeks + ' weeks \u2014 recent decline with opportunity for recovery');
          } else {
            expect(result).toBe('Stable pricing over last ' + weeks + ' weeks');
          }
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 13: Confidence label mapping completeness
  // **Validates: Requirements 2.3, 3.5, 7.7**
  it('Property 13: mapConfidenceLabel returns correct string for each level', () => {
    const expectedLabels: Record<string, string> = {
      high: 'Based on consistent engagement and stable growth',
      medium: 'Based on moderate engagement with developing trends',
      low: 'Based on early data with limited history',
    };

    fc.assert(
      fc.property(
        fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
        (level) => {
          const result = mapConfidenceLabel(level);
          expect(result).toBe(expectedLabels[level]);
          expect(result.length).toBeGreaterThan(0);
        }
      )
    );
  });

  // Feature: sponsor-export-report, Property 11: Template narrative sentence bounds
  // **Validates: Requirements 7.1, 7.4, 2.9**
  it('Property 11: generateTemplateNarrative produces 1-3 sentences with no metric values', () => {
    // Use alpha-only strings to avoid generating strings that look like metric values
    const safeStr = fc.stringMatching(/^[a-zA-Z ]+$/, { minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

    const brandInfoArb: fc.Arbitrary<BrandInfo> = fc.record({
      brandName: fc.oneof(safeStr, fc.constant(undefined)),
      industry: fc.oneof(
        fc.stringMatching(/^[a-zA-Z ]+$/, { minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
        fc.constant(undefined)
      ),
      brandDescription: fc.oneof(
        fc.stringMatching(/^[a-zA-Z ]+$/, { minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        fc.constant(undefined)
      ),
      website: fc.oneof(
        fc.constant('https://example.com'),
        fc.constant(undefined)
      ),
      brandLogo: fc.constant(undefined),
    }) as fc.Arbitrary<BrandInfo>;

    fc.assert(
      fc.property(brandInfoArb, (brandInfo) => {
        const result = generateTemplateNarrative(brandInfo);

        // Count sentences (period followed by space or end of string)
        const sentences = result.split(/\.\s*/).filter(s => s.trim().length > 0);
        expect(sentences.length).toBeGreaterThanOrEqual(1);
        expect(sentences.length).toBeLessThanOrEqual(3);

        // Should not contain metric-like values
        const thousandsSep = /\d{1,3}(,\d{3})+/;
        const pctPattern = /\d+\.\d+%/;
        const currencyPattern = /\$\d/;
        expect(result).not.toMatch(thousandsSep);
        expect(result).not.toMatch(pctPattern);
        expect(result).not.toMatch(currencyPattern);
      })
    );
  });

  // Feature: sponsor-export-report, Property 12: Template narrative excludes raw metric values
  // **Validates: Requirements 7.4**
  it('Property 12: generateTemplateNarrative contains no numeric metric values', () => {
    // Use alpha-only strings to avoid generating strings that look like metric values
    const safeStr12 = fc.stringMatching(/^[a-zA-Z ]+$/, { minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

    const brandInfoArb: fc.Arbitrary<BrandInfo> = fc.record({
      brandName: fc.oneof(safeStr12, fc.constant(undefined)),
      industry: fc.oneof(
        fc.stringMatching(/^[a-zA-Z ]+$/, { minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
        fc.constant(undefined)
      ),
      brandDescription: fc.oneof(
        fc.stringMatching(/^[a-zA-Z ]+$/, { minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        fc.constant(undefined)
      ),
      website: fc.constant(undefined),
      brandLogo: fc.constant(undefined),
    }) as fc.Arbitrary<BrandInfo>;

    fc.assert(
      fc.property(brandInfoArb, (brandInfo) => {
        const result = generateTemplateNarrative(brandInfo);

        // No patterns like "12,500" (thousands-separated numbers)
        const thousandsSep = /\d{1,3}(,\d{3})+/;
        expect(result).not.toMatch(thousandsSep);
        // No patterns like "48.3%" (percentage)
        const pctPattern = /\d+\.\d+%/;
        expect(result).not.toMatch(pctPattern);
        // No patterns like "$150.00" (currency)
        const currencyPattern = /\$\d+/;
        expect(result).not.toMatch(currencyPattern);
      })
    );
  });
});
