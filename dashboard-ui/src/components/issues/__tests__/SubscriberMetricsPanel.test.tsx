import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SubscriberMetricsPanel } from '../SubscriberMetricsPanel';

describe('SubscriberMetricsPanel', () => {
  const getMetricsRegion = () =>
    screen.getByRole('region', { name: 'Subscriber loss metrics' });

  describe('Rendering with all zeros (Req 4.5)', () => {
    it('should display all three counts as 0 rather than hiding the panel', () => {
      render(
        <SubscriberMetricsPanel unsubscribes={0} cleaned={0} manualRemovals={0} />
      );

      const region = getMetricsRegion();
      expect(within(region).getAllByText('Unsubscribes').length).toBeGreaterThan(0);
      expect(within(region).getAllByText('Cleaned').length).toBeGreaterThan(0);
      expect(within(region).getAllByText('Manual Removals').length).toBeGreaterThan(0);
      expect(within(region).getAllByText('Total Loss').length).toBeGreaterThan(0);

      // All metric values should be "0"
      const zeros = within(region).getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Rendering with mixed values (Req 4.1, 4.2, 4.3, 4.6)', () => {
    it('should display individual counts and correct total loss', () => {
      render(
        <SubscriberMetricsPanel unsubscribes={5} cleaned={3} manualRemovals={2} />
      );

      const region = getMetricsRegion();
      expect(within(region).getByText('5')).toBeInTheDocument();
      expect(within(region).getByText('3')).toBeInTheDocument();
      expect(within(region).getByText('2')).toBeInTheDocument();
      // Total loss = 5 + 3 + 2 = 10
      expect(within(region).getByText('10')).toBeInTheDocument();
    });

    it('should display formatted numbers for large values', () => {
      render(
        <SubscriberMetricsPanel unsubscribes={1500} cleaned={200} manualRemovals={50} />
      );

      const region = getMetricsRegion();
      expect(within(region).getByText('1,500')).toBeInTheDocument();
      expect(within(region).getByText('200')).toBeInTheDocument();
      expect(within(region).getByText('50')).toBeInTheDocument();
      expect(within(region).getByText('1,750')).toBeInTheDocument();
    });
  });

  describe('Rendering with missing stats (Req 4.1, 4.2, 4.3)', () => {
    it('should treat undefined values as 0', () => {
      render(<SubscriberMetricsPanel />);

      const region = getMetricsRegion();
      const zeros = within(region).getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(4);
    });

    it('should treat null values as 0', () => {
      render(
        <SubscriberMetricsPanel unsubscribes={null} cleaned={null} manualRemovals={null} />
      );

      const region = getMetricsRegion();
      const zeros = within(region).getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle partial missing stats correctly', () => {
      render(
        <SubscriberMetricsPanel unsubscribes={7} cleaned={undefined} manualRemovals={null} />
      );

      const region = getMetricsRegion();
      // unsubscribes=7, cleaned=0, manualRemovals=0, total=7
      const sevens = within(region).getAllByText('7');
      expect(sevens).toHaveLength(2); // once for unsubscribes, once for total
    });
  });

  describe('Percentage calculation (Req 4.7)', () => {
    it('should display loss percentage when subscribers > 0', () => {
      render(
        <SubscriberMetricsPanel
          unsubscribes={2}
          cleaned={1}
          manualRemovals={0}
          subscribers={1200}
        />
      );

      // Total loss = 3, percentage = (3/1200)*100 = 0.25%
      // The header shows "3 lost of 1,200 sent — 0.25%"
      const allPercentages = screen.getAllByText(/0\.25%/);
      expect(allPercentages.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/3 lost of 1,200 sent/)).toBeInTheDocument();
    });

    it('should round percentage to two decimal places', () => {
      render(
        <SubscriberMetricsPanel
          unsubscribes={1}
          cleaned={0}
          manualRemovals={0}
          subscribers={3}
        />
      );

      // 1/3 * 100 = 33.333... → 33.33%
      const allPercentages = screen.getAllByText(/33\.33%/);
      expect(allPercentages.length).toBeGreaterThanOrEqual(1);
    });

    it('should show percentage in the total loss card', () => {
      render(
        <SubscriberMetricsPanel
          unsubscribes={10}
          cleaned={5}
          manualRemovals={5}
          subscribers={1000}
        />
      );

      // 20/1000 * 100 = 2.00%
      expect(screen.getByText(/2\.00% of subscribers/)).toBeInTheDocument();
    });
  });

  describe('Zero subscribers omits percentage (Req 4.7)', () => {
    it('should not display percentage when subscribers is 0', () => {
      render(
        <SubscriberMetricsPanel
          unsubscribes={5}
          cleaned={3}
          manualRemovals={2}
          subscribers={0}
        />
      );

      const region = getMetricsRegion();
      expect(within(region).getByText('10')).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
      expect(screen.queryByText(/lost of/)).not.toBeInTheDocument();
    });

    it('should not display percentage when subscribers is undefined', () => {
      render(
        <SubscriberMetricsPanel unsubscribes={5} cleaned={3} manualRemovals={2} />
      );

      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });

    it('should not display percentage when subscribers is null', () => {
      render(
        <SubscriberMetricsPanel
          unsubscribes={5}
          cleaned={3}
          manualRemovals={2}
          subscribers={null}
        />
      );

      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have a subscriber loss metrics region', () => {
      render(
        <SubscriberMetricsPanel unsubscribes={1} cleaned={2} manualRemovals={3} />
      );

      expect(
        screen.getByRole('region', { name: 'Subscriber loss metrics' })
      ).toBeInTheDocument();
    });
  });
});
