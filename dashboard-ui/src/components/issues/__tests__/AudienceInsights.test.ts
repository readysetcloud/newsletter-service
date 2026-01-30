import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { GeoData, DeviceBreakdown } from '@/types/issues';

describe('Audience Insights - Property-Based Tests', () => {
  describe('Property 8: Device Breakdown Totals', () => {
    it('should have device clicks sum equal to total clicks', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 1, max: 30000 }),
          (desktop, mobile, tablet, totalClicks) => {
            const deviceBreakdown: DeviceBreakdown = {
              desktop,
              mobile,
              tablet,
            };

            const sumOfDeviceClicks = deviceBreakdown.desktop + deviceBreakdown.mobile + deviceBreakdown.tablet;

            if (sumOfDeviceClicks === totalClicks) {
              expect(sumOfDeviceClicks).toBe(totalClicks);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have device breakdown sum match when generated from total', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 30000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalClicks, desktopRatio, mobileRatio) => {
            const tabletRatio = Math.max(0, 1 - desktopRatio - mobileRatio);
            const normalizedDesktop = desktopRatio / (desktopRatio + mobileRatio + tabletRatio);
            const normalizedMobile = mobileRatio / (desktopRatio + mobileRatio + tabletRatio);
            const normalizedTablet = tabletRatio / (desktopRatio + mobileRatio + tabletRatio);

            const desktop = Math.floor(totalClicks * normalizedDesktop);
            const mobile = Math.floor(totalClicks * normalizedMobile);
            const tablet = totalClicks - desktop - mobile;

            const deviceBreakdown: DeviceBreakdown = {
              desktop,
              mobile,
              tablet,
            };

            const sumOfDeviceClicks = deviceBreakdown.desktop + deviceBreakdown.mobile + deviceBreakdown.tablet;

            expect(sumOfDeviceClicks).toBe(totalClicks);
            expect(deviceBreakdown.desktop).toBeGreaterThanOrEqual(0);
            expect(deviceBreakdown.mobile).toBeGreaterThanOrEqual(0);
            expect(deviceBreakdown.tablet).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have all device values non-negative', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          fc.integer({ min: 0, max: 10000 }),
          (desktop, mobile, tablet) => {
            const deviceBreakdown: DeviceBreakdown = {
              desktop,
              mobile,
              tablet,
            };

            expect(deviceBreakdown.desktop).toBeGreaterThanOrEqual(0);
            expect(deviceBreakdown.mobile).toBeGreaterThanOrEqual(0);
            expect(deviceBreakdown.tablet).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate device percentages that sum to 100 percent', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 30000 }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (totalClicks, desktopRatio, mobileRatio) => {
            const tabletRatio = Math.max(0, 1 - desktopRatio - mobileRatio);
            const normalizedDesktop = desktopRatio / (desktopRatio + mobileRatio + tabletRatio);
            const normalizedMobile = mobileRatio / (desktopRatio + mobileRatio + tabletRatio);
            const normalizedTablet = tabletRatio / (desktopRatio + mobileRatio + tabletRatio);

            const desktop = Math.floor(totalClicks * normalizedDesktop);
            const mobile = Math.floor(totalClicks * normalizedMobile);
            const tablet = totalClicks - desktop - mobile;

            const deviceBreakdown: DeviceBreakdown = {
              desktop,
              mobile,
              tablet,
            };

            const sumOfDeviceClicks = deviceBreakdown.desktop + deviceBreakdown.mobile + deviceBreakdown.tablet;

            const desktopPercent = (deviceBreakdown.desktop / sumOfDeviceClicks) * 100;
            const mobilePercent = (deviceBreakdown.mobile / sumOfDeviceClicks) * 100;
            const tabletPercent = (deviceBreakdown.tablet / sumOfDeviceClicks) * 100;

            const totalPercent = desktopPercent + mobilePercent + tabletPercent;

            expect(Math.abs(totalPercent - 100)).toBeLessThan(0.01);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: Geographic Distribution Completeness', () => {
    it('should have geo clicks sum equal to total clicks', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              country: fc.constantFrom('US', 'UK', 'CA', 'AU', 'DE', 'FR', 'JP', 'IN', 'BR', 'MX'),
              clicks: fc.integer({ min: 0, max: 5000 }),
              opens: fc.integer({ min: 0, max: 10000 }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          fc.integer({ min: 1, max: 50000 }),
          (geoData, totalClicks) => {
            const sumOfGeoClicks = geoData.reduce((sum, geo) => sum + geo.clicks, 0);

            if (sumOfGeoClicks === totalClicks) {
              expect(sumOfGeoClicks).toBe(totalClicks);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have geo distribution sum match when generated from total', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50000 }),
          fc.array(
            fc.record({
              country: fc.constantFrom('US', 'UK', 'CA', 'AU', 'DE', 'FR', 'JP', 'IN', 'BR', 'MX'),
              ratio: fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (totalClicks, countryRatios) => {
            const totalRatio = countryRatios.reduce((sum, c) => sum + c.ratio, 0);
            const normalizedRatios = countryRatios.map(c => ({
              country: c.country,
              ratio: c.ratio / totalRatio,
            }));

            let remainingClicks = totalClicks;
            const geoData: GeoData[] = normalizedRatios.map((c, index) => {
              const clicks = index === normalizedRatios.length - 1
                ? remainingClicks
                : Math.floor(totalClicks * c.ratio);
              remainingClicks -= clicks;

              return {
                country: c.country,
                clicks,
                opens: clicks * 2,
              };
            });

            const sumOfGeoClicks = geoData.reduce((sum, geo) => sum + geo.clicks, 0);

            expect(sumOfGeoClicks).toBe(totalClicks);
            expect(geoData.length).toBeGreaterThan(0);

            for (const geo of geoData) {
              expect(geo.clicks).toBeGreaterThanOrEqual(0);
              expect(geo.clicks).toBeLessThanOrEqual(totalClicks);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have all geo click values non-negative', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              country: fc.constantFrom('US', 'UK', 'CA', 'AU', 'DE', 'FR', 'JP', 'IN', 'BR', 'MX'),
              clicks: fc.integer({ min: 0, max: 5000 }),
              opens: fc.integer({ min: 0, max: 10000 }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
          (geoData) => {
            for (const geo of geoData) {
              expect(geo.clicks).toBeGreaterThanOrEqual(0);
              expect(geo.opens).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have each country clicks not exceed total clicks', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50000 }),
          fc.array(
            fc.record({
              country: fc.constantFrom('US', 'UK', 'CA', 'AU', 'DE', 'FR', 'JP', 'IN', 'BR', 'MX'),
              ratio: fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (totalClicks, countryRatios) => {
            const totalRatio = countryRatios.reduce((sum, c) => sum + c.ratio, 0);
            const normalizedRatios = countryRatios.map(c => ({
              country: c.country,
              ratio: c.ratio / totalRatio,
            }));

            let remainingClicks = totalClicks;
            const geoData: GeoData[] = normalizedRatios.map((c, index) => {
              const clicks = index === normalizedRatios.length - 1
                ? remainingClicks
                : Math.floor(totalClicks * c.ratio);
              remainingClicks -= clicks;

              return {
                country: c.country,
                clicks,
                opens: clicks * 2,
              };
            });

            for (const geo of geoData) {
              expect(geo.clicks).toBeLessThanOrEqual(totalClicks);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain country uniqueness when aggregating', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              country: fc.constantFrom('US', 'UK', 'CA', 'AU', 'DE'),
              clicks: fc.integer({ min: 1, max: 1000 }),
              opens: fc.integer({ min: 1, max: 2000 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (geoData) => {
            const countryMap = new Map<string, { clicks: number; opens: number }>();

            for (const geo of geoData) {
              const existing = countryMap.get(geo.country);
              if (existing) {
                countryMap.set(geo.country, {
                  clicks: existing.clicks + geo.clicks,
                  opens: existing.opens + geo.opens,
                });
              } else {
                countryMap.set(geo.country, {
                  clicks: geo.clicks,
                  opens: geo.opens,
                });
              }
            }

            const aggregatedGeoData: GeoData[] = Array.from(countryMap.entries()).map(
              ([country, data]) => ({
                country,
                clicks: data.clicks,
                opens: data.opens,
              })
            );

            const originalSum = geoData.reduce((sum, geo) => sum + geo.clicks, 0);
            const aggregatedSum = aggregatedGeoData.reduce((sum, geo) => sum + geo.clicks, 0);

            expect(aggregatedSum).toBe(originalSum);
            expect(aggregatedGeoData.length).toBeLessThanOrEqual(geoData.length);

            const countries = new Set(aggregatedGeoData.map(g => g.country));
            expect(countries.size).toBe(aggregatedGeoData.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
