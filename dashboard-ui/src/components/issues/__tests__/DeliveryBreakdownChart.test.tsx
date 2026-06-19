import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryBreakdownChart } from '../DeliveryBreakdownChart';

describe('DeliveryBreakdownChart', () => {
  describe('Rendering', () => {
    it('should render delivered, bounced, and sent labels', () => {
      render(<DeliveryBreakdownChart delivered={950} bounced={50} />);

      expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Bounced').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    });

    it('should display the total sent count in the center', () => {
      render(<DeliveryBreakdownChart delivered={950} bounced={50} />);

      // Sent = delivered + bounced = 1,000 (appears in center and breakdown list)
      expect(screen.getAllByText('1,000').length).toBeGreaterThan(0);
    });

    it('should display counts with percentages in the breakdown list', () => {
      render(<DeliveryBreakdownChart delivered={950} bounced={50} />);

      expect(screen.getByText('950 (95.0%)')).toBeInTheDocument();
      expect(screen.getByText('50 (5.0%)')).toBeInTheDocument();
    });

    it('should expose an accessible summary of the breakdown', () => {
      render(<DeliveryBreakdownChart delivered={950} bounced={50} />);

      expect(
        screen.getByRole('img', {
          name: /950 delivered \(95\.0%\) and 50 bounced \(5\.0%\) out of 1,000 sent/i,
        })
      ).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should render an empty state when nothing was sent', () => {
      render(<DeliveryBreakdownChart delivered={0} bounced={0} />);

      expect(screen.getByText(/no delivery data available/i)).toBeInTheDocument();
    });

    it('should handle a 100% delivered send', () => {
      render(<DeliveryBreakdownChart delivered={500} bounced={0} />);

      expect(screen.getByText('500 (100.0%)')).toBeInTheDocument();
      expect(screen.getByText('0 (0.0%)')).toBeInTheDocument();
    });

    it('should treat negative inputs as zero', () => {
      render(<DeliveryBreakdownChart delivered={-10} bounced={-5} />);

      expect(screen.getByText(/no delivery data available/i)).toBeInTheDocument();
    });
  });
});
