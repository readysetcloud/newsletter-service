import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyMetricsSummary } from '../KeyMetricsSummary';
import type { IssueMetrics } from '@/types/issues';

describe('KeyMetricsSummary', () => {
  const mockMetrics = {
    deliveries: 1000,
    openRate: 45.5,
    clickRate: 12.3,
    clickToOpenRate: 27.0,
    bounceRate: 2.1,
    complaintRate: 0.05,
    unsubscribeRate: 0.3,
  };

  const mockComparisons = {
    average: {
      openRate: 40.0,
      clickRate: 10.0,
      clickToOpenRate: 25.0,
      bounceRate: 3.0,
      delivered: 900,
      opens: 360,
      clicks: 90,
      bounces: 27,
      complaints: 1,
      unsubscribes: 4,
      subscribers: 1000,
    } as IssueMetrics,
  };

  describe('Rendering', () => {
    it('should render all six rate metric cards', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.getAllByText('Open Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Click Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Click-to-Open Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Bounce Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Complaint Rate').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Unsubscribe Rate').length).toBeGreaterThan(0);
    });

    it('should not render a standalone Deliveries card', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.queryByText('Deliveries')).not.toBeInTheDocument();
    });

    it('should display formatted metric values', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.getByText('45.5%')).toBeInTheDocument();
      expect(screen.getByText('12.3%')).toBeInTheDocument();
      expect(screen.getByText('27.0%')).toBeInTheDocument();
      expect(screen.getByText('2.1%')).toBeInTheDocument();
      expect(screen.getByText('0.05%')).toBeInTheDocument();
      expect(screen.getByText('0.30%')).toBeInTheDocument();
    });

    it('should display absolute numbers alongside percentages', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.getByText('455 opens')).toBeInTheDocument();
      expect(screen.getByText('123 clicks')).toBeInTheDocument();
      expect(screen.getByText('21 bounces')).toBeInTheDocument();
      expect(screen.getByText('1 complaints')).toBeInTheDocument();
      expect(screen.getByText('3 unsubscribes')).toBeInTheDocument();
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
        clickToOpenRate: 0,
        bounceRate: 0,
        complaintRate: 0,
        unsubscribeRate: 0,
      };

      render(<KeyMetricsSummary metrics={zeroMetrics} />);

      expect(screen.getByText('0 opens')).toBeInTheDocument();
      expect(screen.getAllByText('0.0%').length).toBeGreaterThan(0);
    });

    it('should handle very high complaint rate', () => {
      const highComplaintMetrics = {
        deliveries: 1000,
        openRate: 45.5,
        clickRate: 12.3,
        clickToOpenRate: 27.0,
        bounceRate: 2.1,
        complaintRate: 0.15,
        unsubscribeRate: 0.3,
      };

      render(<KeyMetricsSummary metrics={highComplaintMetrics} />);

      expect(screen.getByText('0.15%')).toBeInTheDocument();
    });
  });

  describe('Status badges', () => {
    it('should flag metrics above critical thresholds', () => {
      const riskyMetrics = {
        ...mockMetrics,
        bounceRate: 12.0,
        complaintRate: 0.15,
      };

      render(<KeyMetricsSummary metrics={riskyMetrics} />);

      expect(screen.getAllByText('Critical')).toHaveLength(2);
    });

    it('should flag metrics in the warning band as high', () => {
      const warningMetrics = {
        ...mockMetrics,
        bounceRate: 6.0,
        unsubscribeRate: 0.7,
      };

      render(<KeyMetricsSummary metrics={warningMetrics} />);

      expect(screen.getAllByText('High')).toHaveLength(2);
    });

    it('should not show status badges for healthy metrics', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} />);

      expect(screen.queryByText('Critical')).not.toBeInTheDocument();
      expect(screen.queryByText('High')).not.toBeInTheDocument();
    });
  });

  describe('Comparison baseline toggle', () => {
    const multiComparisons = {
      ...mockComparisons,
      lastIssue: { ...mockComparisons.average, openRate: 42.0 },
      bestIssue: { ...mockComparisons.average, openRate: 50.0 },
    };

    it('should render the toggle when a change handler and multiple baselines exist', () => {
      render(
        <KeyMetricsSummary
          metrics={mockMetrics}
          comparisons={multiComparisons}
          onHighlightModeChange={vi.fn()}
        />
      );

      const group = screen.getByRole('group', { name: 'Comparison baseline' });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Average' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Last issue' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Best issue' })).toBeInTheDocument();
    });

    it('should call the handler with the selected mode', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <KeyMetricsSummary
          metrics={mockMetrics}
          comparisons={multiComparisons}
          onHighlightModeChange={onChange}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Best issue' }));

      expect(onChange).toHaveBeenCalledWith('best');
    });

    it('should not render the toggle without a change handler', () => {
      render(<KeyMetricsSummary metrics={mockMetrics} comparisons={multiComparisons} />);

      expect(screen.queryByRole('group', { name: 'Comparison baseline' })).not.toBeInTheDocument();
    });
  });

  describe('Sparklines', () => {
    it('should render a sparkline when history is provided', () => {
      const { container } = render(
        <KeyMetricsSummary
          metrics={mockMetrics}
          sparklines={{ openRate: [38.2, 41.0, 39.5, 45.5] }}
        />
      );

      expect(container.querySelectorAll('svg polyline').length).toBe(1);
    });

    it('should not render sparklines for single-point history', () => {
      const { container } = render(
        <KeyMetricsSummary metrics={mockMetrics} sparklines={{ openRate: [45.5] }} />
      );

      expect(container.querySelectorAll('svg polyline').length).toBe(0);
    });
  });
});
