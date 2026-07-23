import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngagementFunnel } from '../EngagementFunnel';

describe('EngagementFunnel', () => {
  const defaultProps = {
    delivered: 980,
    bounced: 20,
    opens: 441,
    clicks: 120,
  };

  describe('Rendering', () => {
    it('should render all four funnel stages', () => {
      render(<EngagementFunnel {...defaultProps} />);

      expect(screen.getByText('Sent')).toBeInTheDocument();
      expect(screen.getByText('Delivered')).toBeInTheDocument();
      expect(screen.getByText('Opened')).toBeInTheDocument();
      expect(screen.getByText('Clicked')).toBeInTheDocument();
    });

    it('should display stage counts', () => {
      render(<EngagementFunnel {...defaultProps} />);

      expect(screen.getByText('1,000')).toBeInTheDocument(); // sent = delivered + bounced
      expect(screen.getByText('980')).toBeInTheDocument();
      expect(screen.getByText('441')).toBeInTheDocument();
      expect(screen.getByText('120')).toBeInTheDocument();
    });

    it('should display stage-to-stage conversion annotations', () => {
      render(<EngagementFunnel {...defaultProps} />);

      expect(screen.getByText(/98\.0% delivered — 20 bounced/)).toBeInTheDocument();
      expect(screen.getByText(/45\.0% of delivered opened/)).toBeInTheDocument();
      expect(screen.getByText(/27\.2% of opens clicked/)).toBeInTheDocument();
    });

    it('should omit the bounce note when nothing bounced', () => {
      render(<EngagementFunnel {...defaultProps} bounced={0} />);

      expect(screen.getByText(/100\.0% delivered/)).toBeInTheDocument();
      expect(screen.queryByText(/bounced/)).not.toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('should show an empty state when nothing was sent', () => {
      render(<EngagementFunnel delivered={0} bounced={0} opens={0} clicks={0} />);

      expect(screen.getByText('No delivery data available for this issue.')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should expose a summary of the funnel to assistive tech', () => {
      render(<EngagementFunnel {...defaultProps} />);

      expect(
        screen.getByLabelText('Engagement funnel: 1,000 sent, 980 delivered, 441 opened, 120 clicked.')
      ).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle negative or missing values gracefully', () => {
      render(<EngagementFunnel delivered={100} bounced={-5} opens={0} clicks={0} />);

      expect(screen.getByText('Sent')).toBeInTheDocument();
      expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    });
  });
});
