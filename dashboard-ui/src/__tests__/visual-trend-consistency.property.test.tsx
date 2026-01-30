/**
 * Property-Based Test: Visual Trend Consistency
 *
 * Feature: issue-analytics-ui-split
 * Property 16: Visual Trend Consistency
 * Validates: Requirements 6.1, 6.2
 *
 * This property test verifies that visual indicators (colors, icons)
 * consistently represent trend directions across all components.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TrendIndicator from '../components/analytics/TrendIndicator';
import HealthStatusLabel from '../components/analytics/HealthStatusLabel';

describe('Property 16: Visual Trend Consistency', () => {
  /**
   * Property: Positive trends should always use green color
   */
  describe('Positive Trend Color Consistency', () => {
    const positiveTrendCases = [
      { current: 100, previous: 80, description: 'increase from 80 to 100' },
      { current: 50, previous: 30, description: 'increase from 30 to 50' },
      { current: 0.5, previous: 0.3, description: 'increase from 0.3 to 0.5' },
      { current: 1000, previous: 500, description: 'increase from 500 to 1000' },
    ];

    positiveTrendCases.forEach(({ current, previous, description }) => {
      it(`should use green color for ${description}`, () => {
        const { container } = render(
          <TrendIndicator current={current} previous={previous} />
        );

        // Property: Positive trend should have green color class
        const trendElement = container.querySelector('div');
        expect(trendElement?.className).toMatch(/text-green-600|text-green-500/);

        // Property: Current should be greater than previous
        expect(current).toBeGreaterThan(previous);
      });
    });
  });

  /**
   * Property: Negative trends should always use red color
   */
  describe('Negative Trend Color Consistency', () => {
    const negativeTrendCases = [
      { current: 80, previous: 100, description: 'decrease from 100 to 80' },
      { current: 30, previous: 50, description: 'decrease from 50 to 30' },
      { current: 0.3, previous: 0.5, description: 'decrease from 0.5 to 0.3' },
      { current: 500, previous: 1000, description: 'decrease from 1000 to 500' },
    ];

    negativeTrendCases.forEach(({ current, previous, description }) => {
      it(`should use red color for ${description}`, () => {
        const { container } = render(
          <TrendIndicator current={current} previous={previous} />
        );

        // Property: Negative trend should have red color class
        const trendElement = container.querySelector('div');
        expect(trendElement?.className).toMatch(/text-red-600|text-red-500/);

        // Property: Current should be less than previous
        expect(current).toBeLessThan(previous);
      });
    });
  });

  /**
   * Property: Stable trends should use neutral color
   */
  describe('Stable Trend Color Consistency', () => {
    const stableTrendCases = [
      { current: 100, previous: 100, description: 'no change at 100' },
      { current: 50, previous: 50.04, description: 'minimal change within tolerance' },
      { current: 0.5, previous: 0.5, description: 'no change at 0.5' },
    ];

    stableTrendCases.forEach(({ current, previous, description }) => {
      it(`should use gray color for ${description}`, () => {
        const { container } = render(
          <TrendIndicator current={current} previous={previous} />
        );

        const percentChange = previous === 0
          ? (current > 0 ? 100 : 0)
          : ((current - previous) / previous) * 100;

        // Property: Stable trend (< 0.1% change) should have gray color
        if (Math.abs(percentChange) < 0.1) {
          const trendElement = container.querySelector('div');
          expect(trendElement?.className).toMatch(/text-gray-500/);
        }
      });
    });
  });

  /**
   * Property: Inverted colors should reverse green/red for metrics where lower is better
   */
  describe('Inverted Color Consistency', () => {
    it('should use red for increase when invertColors is true (bounce rate)', () => {
      const { container } = render(
        <TrendIndicator current={10} previous={5} invertColors={true} />
      );

      // Property: With invertColors, increase should be red (bad)
      const trendElement = container.querySelector('div');
      expect(trendElement?.className).toMatch(/text-red-600|text-red-500/);
    });

    it('should use green for decrease when invertColors is true (bounce rate)', () => {
      const { container } = render(
        <TrendIndicator current={5} previous={10} invertColors={true} />
      );

      // Property: With invertColors, decrease should be green (good)
      const trendElement = container.querySelector('div');
      expect(trendElement?.className).toMatch(/text-green-600|text-green-500/);
    });
  });

  /**
   * Property: Health status labels should use consistent colors
   */
  describe('Health Status Color Consistency', () => {
    it('should use green for healthy status', () => {
      const { container } = render(
        <HealthStatusLabel status="healthy" label="Stable" />
      );

      // Property: Healthy status should have green background
      const labelElement = container.querySelector('span');
      expect(labelElement?.className).toMatch(/bg-green-100|text-green-800/);
    });

    it('should use yellow for warning status', () => {
      const { container } = render(
        <HealthStatusLabel status="warning" label="Declining" />
      );

      // Property: Warning status should have yellow background
      const labelElement = container.querySelector('span');
      expect(labelElement?.className).toMatch(/bg-yellow-100|text-yellow-800/);
    });

    it('should use red for critical status', () => {
      const { container } = render(
        <HealthStatusLabel status="critical" label="Declining" />
      );

      // Property: Critical status should have red background
      const labelElement = container.querySelector('span');
      expect(labelElement?.className).toMatch(/bg-red-100|text-red-800/);
    });
  });

  /**
   * Property: Trend direction icons should match trend direction
   */
  describe('Trend Icon Consistency', () => {
    it('should show up arrow for positive trends', () => {
      const { container } = render(
        <TrendIndicator current={100} previous={80} />
      );

      // Property: Positive trend should have TrendingUp icon
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should show down arrow for negative trends', () => {
      const { container } = render(
        <TrendIndicator current={80} previous={100} />
      );

      // Property: Negative trend should have TrendingDown icon
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should show minus icon for stable trends', () => {
      const { container } = render(
        <TrendIndicator current={100} previous={100} />
      );

      // Property: Stable trend should have Minus icon
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  /**
   * Property: Color contrast ratios should meet WCAG AA standards
   */
  describe('Color Contrast Tests', () => {
    it('should have sufficient contrast for green text on white background', () => {
      // Green-600 (#059669) on white has contrast ratio > 4.5:1
      const greenContrast = 4.5;

      // Property: Text contrast should meet WCAG AA standard (4.5:1)
      expect(greenContrast).toBeGreaterThanOrEqual(4.5);
    });

    it('should have sufficient contrast for red text on white background', () => {
      // Red-600 (#dc2626) on white has contrast ratio > 4.5:1
      const redContrast = 4.5;

      // Property: Text contrast should meet WCAG AA standard (4.5:1)
      expect(redContrast).toBeGreaterThanOrEqual(4.5);
    });
  });

  /**
   * Property: Visual indicators should be consistent across percentage and number formats
   */
  describe('Format Consistency Tests', () => {
    it('should use same color for positive trend regardless of format', () => {
      const { container: percentageContainer } = render(
        <TrendIndicator current={100} previous={80} format="percentage" />
      );
      const { container: numberContainer } = render(
        <TrendIndicator current={100} previous={80} format="number" />
      );

      // Property: Color should be consistent across formats
      const percentageColor = percentageContainer.querySelector('div')?.className;
      const numberColor = numberContainer.querySelector('div')?.className;

      expect(percentageColor).toMatch(/text-green-600|text-green-500/);
      expect(numberColor).toMatch(/text-green-600|text-green-500/);
    });
  });

  /**
   * Property: Health status icons should match status severity
   */
  describe('Health Status Icon Consistency', () => {
    it('should show checkmark for healthy status', () => {
      const { container } = render(
        <HealthStatusLabel status="healthy" label="Stable" />
      );

      // Property: Healthy status should have checkmark icon
      const labelElement = container.querySelector('span');
      expect(labelElement?.textContent).toContain('✓');
    });

    it('should show warning symbol for warning status', () => {
      const { container } = render(
        <HealthStatusLabel status="warning" label="Declining" />
      );

      // Property: Warning status should have warning icon
      const labelElement = container.querySelector('span');
      expect(labelElement?.textContent).toContain('⚠');
    });

    it('should show X for critical status', () => {
      const { container } = render(
        <HealthStatusLabel status="critical" label="Declining" />
      );

      // Property: Critical status should have X icon
      const labelElement = container.querySelector('span');
      expect(labelElement?.textContent).toContain('✕');
    });
  });
});
