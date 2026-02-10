import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyMetricsSummary } from '../KeyMetricsSummary';
import type { IssueMetrics } from '@/types/issues';

describe('KeyMetricsSummary', () => {
  const mockMetrics = {
    deliveries: 1000,
    openRate: 45.5,
    clickRate: 12.3,
    bounceRate: 2.1,
    complaintRate: 0.05,
  };

  const mockComparisons = {
    average: {
      openRate: 40.0,
      clickRate: 10.0,
      bounceRate: 3.0,
      delivered: 900,
      opens: 360,
      clicks: 90,
      bounces: 27,
      complaints: 1,
      subscribers: 1000,
    } as IssueMetrics,
  };

  describe('Rendering', () => {
    it('should render all five metric cards', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.getAllByText('Deliveries').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Open Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Click Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Bounce Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Complaint Rate').length).toBeGreaterThan(0);
    });

    it('should display formatted metric values', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.getByText('1,000')).toBeInTheDocument();
      expect(screen.getByText('45.5%')).toBeInTheDocument();
      expect(screen.getByText('12.3%')).toBeInTheDocument();
      expect(screen.getByText('2.1%')).toBeInTheDocument();
      expect(screen.getByText('0.05%')).toBeInTheDocument();
    });

    it('should display absolute numbers alongside percentages', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.getByText('455 opens')).toBeInTheDocument();
      expect(screen.getByText('123 clicks')).toBeInTheDocument();
      expect(screen.getByText('21 bounces')).toBeInTheDocument();
      expect(screen.getByText('1 complaints')).toBeInTheDocument();
    });
  });

  describe('Comparison indicators', () => {
    it('should display comparison indicators when comparisons are provided', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} comparisons={mockComparisons} />);

      const comparisonTexts = screen.getAllByText(/vs\. avg/i);
      expect(comparisonTexts.length).toBeGreaterThan(0);
    });

    it('should show positive trend for improved open rate', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} comparisons={mockComparisons} />);

      expect(screen.getByText(/\+13\.8%/)).toBeInTheDocument();
    });

    it('should show positive trend for improved click rate', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} comparisons={mockComparisons} />);

      expect(screen.getByText(/\+23\.0%/)).toBeInTheDocument();
    });

    it('should show positive trend for reduced bounce rate', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} comparisons={mockComparisons} />);

      expect(screen.getByText(/-30\.0%/)).toBeInTheDocument();
    });

    it('should not display comparison indicators when comparisons are not provided', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      const comparisonTexts = screen.queryAllByText(/vs\./i);
      expect(comparisonTexts).toHaveLength(0);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.getByLabelText('Key performance metrics')).toBeInTheDocument();
    });

    it('should have proper role attributes', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      const region = screen.getByRole('region', { name: 'Key performance metrics' });
      expect(region).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle zero deliveries gracefully', () => {
      const zeroMetrics = {
        deliveries: 0,
        openRate: 0,
        clickRate: 0,
        bounceRate: 0,
        complaintRate: 0,
      };

      render(<KeyMetricsSummary metrics={zeroMetrics} />);

      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getAllByText('0.0%').length).toBeGreaterThan(0);
    });

    it('should handle very high complaint rate', () => {
      const highComplaintMetrics = {
        deliveries: 1000,
        openRate: 45.5,
        clickRate: 12.3,
        bounceRate: 2.1,
        complaintRate: 0.15,
      };

      render(<KeyMetricsSummary metrics={highComplaintMetrics} />);

      expect(screen.getByText('0.15%')).toBeInTheDocument();
    });
  });
});
