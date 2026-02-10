import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliverabilityHealthCard } from '../DeliverabilityHealthCard';

describe('DeliverabilityHealthCard', () => {
  describe('Health Status Calculation', () => {
    it('should display "Excellent" health for low bounce and complaint rates', () => {
      render(<DeliverabilityHealthCard bounceRate={1.5} complaintRate={0.005} />);

      expect(screen.getByText('Excellent')).toBeInTheDocument();
      expect(
        screen.getByText('Your deliverability metrics are excellent. Keep up the good work!')
      ).toBeInTheDocument();
    });

    it('should display "Good" health for moderate bounce and complaint rates', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.03} />);

      expect(screen.getByText('Good')).toBeInTheDocument();
      expect(
        screen.getByText('Your deliverability metrics are within acceptable ranges.')
      ).toBeInTheDocument();
    });

    it('should display "Warning" health for elevated bounce rate', () => {
      render(<DeliverabilityHealthCard bounceRate={6.0} complaintRate={0.03} />);

      expect(screen.getByText('Warning')).toBeInTheDocument();
      expect(
        screen.getByText('Some metrics need attention to maintain good deliverability.')
      ).toBeInTheDocument();
    });

    it('should display "Warning" health for elevated complaint rate', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.08} />);

      expect(screen.getByText('Warning')).toBeInTheDocument();
    });

    it('should display "Critical" health for high bounce rate', () => {
      render(<DeliverabilityHealthCard bounceRate={12.0} complaintRate={0.03} />);

      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(
        screen.getByText('Immediate action required to protect your sender reputation.')
      ).toBeInTheDocument();
    });

    it('should display "Critical" health for high complaint rate', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.15} />);

      expect(screen.getByText('Critical')).toBeInTheDocument();
    });
  });

  describe('Progress Bars', () => {
    it('should render bounce rate progress bar with correct value', () => {
      render(<DeliverabilityHealthCard bounceRate={4.5} complaintRate={0.05} />);

      const bounceRateLabels = screen.getAllByText('Bounce Rate');
      expect(bounceRateLabels.length).toBeGreaterThan(0);
      expect(screen.getByText('4.5%')).toBeInTheDocument();
    });

    it('should render complaint rate progress bar with correct value', () => {
      render(<DeliverabilityHealthCard bounceRate={2.0} complaintRate={0.08} />);

      const complaintRateLabels = screen.getAllByText('Complaint Rate');
      expect(complaintRateLabels.length).toBeGreaterThan(0);
      expect(screen.getByText('0.08%')).toBeInTheDocument();
    });

    it('should display color zone labels for bounce rate', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.05} />);

      expect(screen.getByText('Good (<2%)')).toBeInTheDocument();
      expect(screen.getByText('Warning (2-5%)')).toBeInTheDocument();
      expect(screen.getByText('Critical (>5%)')).toBeInTheDocument();
    });

    it('should display color zone labels for complaint rate', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.05} />);

      expect(screen.getByText('Good (<0.01%)')).toBeInTheDocument();
      expect(screen.getByText('Warning (0.01-0.1%)')).toBeInTheDocument();
      expect(screen.getByText('Critical (>0.1%)')).toBeInTheDocument();
    });

    it('should have proper ARIA attributes on progress bars', () => {
      render(<DeliverabilityHealthCard bounceRate={4.5} complaintRate={0.08} />);

      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars).toHaveLength(2);

      expect(progressBars[0]).toHaveAttribute('aria-valuenow', '4.5');
      expect(progressBars[0]).toHaveAttribute('aria-valuemin', '0');
      expect(progressBars[0]).toHaveAttribute('aria-valuemax', '100');

      expect(progressBars[1]).toHaveAttribute('aria-valuenow', '0.08');
    });
  });

  describe('Warning Banner', () => {
    it('should display warning banner for high bounce rate', () => {
      render(<DeliverabilityHealthCard bounceRate={7.5} complaintRate={0.03} />);

      expect(screen.getByText('Deliverability Issues Detected')).toBeInTheDocument();
      expect(screen.getByText(/High Bounce Rate \(7\.5%\)/)).toBeInTheDocument();
      expect(
        screen.getByText(/Your bounce rate exceeds the recommended threshold of 5%/)
      ).toBeInTheDocument();
    });

    it('should display warning banner for high complaint rate', () => {
      render(<DeliverabilityHealthCard bounceRate={2.0} complaintRate={0.15} />);

      expect(screen.getByText('Deliverability Issues Detected')).toBeInTheDocument();
      expect(screen.getByText(/High Complaint Rate \(0\.15%\)/)).toBeInTheDocument();
      expect(
        screen.getByText(/Your complaint rate exceeds the critical threshold of 0\.1%/)
      ).toBeInTheDocument();
    });

    it('should display both warnings when both rates are high', () => {
      render(<DeliverabilityHealthCard bounceRate={8.0} complaintRate={0.2} />);

      expect(screen.getByText(/High Bounce Rate \(8\.0%\)/)).toBeInTheDocument();
      expect(screen.getByText(/High Complaint Rate \(0\.20%\)/)).toBeInTheDocument();
    });

    it('should not display warning banner when rates are acceptable', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.05} />);

      expect(screen.queryByText('Deliverability Issues Detected')).not.toBeInTheDocument();
    });

    it('should have proper alert role for warning banner', () => {
      render(<DeliverabilityHealthCard bounceRate={7.5} complaintRate={0.03} />);

      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  describe('Additional Context', () => {
    it('should display bounce reasons breakdown when provided', () => {
      const bounceReasons = {
        permanent: 10,
        temporary: 5,
        suppressed: 2,
      };

      render(
        <DeliverabilityHealthCard
          bounceRate={3.0}
          complaintRate={0.05}
          bounceReasons={bounceReasons}
        />
      );

      expect(screen.getByText(/Bounce breakdown: 10 permanent, 5 temporary, 2 suppressed/)).toBeInTheDocument();
    });

    it('should display complaint count when provided', () => {
      const complaintDetails = [
        { email: 'user1@example.com', timestamp: '2024-01-01', complaintType: 'spam' },
        { email: 'user2@example.com', timestamp: '2024-01-02', complaintType: 'spam' },
      ];

      render(
        <DeliverabilityHealthCard
          bounceRate={3.0}
          complaintRate={0.05}
          complaintDetails={complaintDetails}
        />
      );

      expect(screen.getByText(/2 complaints received/)).toBeInTheDocument();
    });

    it('should display both bounce reasons and complaint count', () => {
      const bounceReasons = {
        permanent: 10,
        temporary: 5,
        suppressed: 2,
      };

      const complaintDetails = [
        { email: 'user1@example.com', timestamp: '2024-01-01', complaintType: 'spam' },
      ];

      render(
        <DeliverabilityHealthCard
          bounceRate={3.0}
          complaintRate={0.05}
          bounceReasons={bounceReasons}
          complaintDetails={complaintDetails}
        />
      );

      expect(screen.getByText(/Bounce breakdown: 10 permanent, 5 temporary, 2 suppressed/)).toBeInTheDocument();
      expect(screen.getByText(/1 complaint received/)).toBeInTheDocument();
    });

    it('should use singular form for single complaint', () => {
      const complaintDetails = [
        { email: 'user1@example.com', timestamp: '2024-01-01', complaintType: 'spam' },
      ];

      render(
        <DeliverabilityHealthCard
          bounceRate={3.0}
          complaintRate={0.05}
          complaintDetails={complaintDetails}
        />
      );

      expect(screen.getByText(/1 complaint received/)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper status role for health indicator', () => {
      render(<DeliverabilityHealthCard bounceRate={1.5} complaintRate={0.005} />);

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-label', 'Deliverability health: Excellent');
    });

    it('should have descriptive card title and description', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.05} />);

      expect(screen.getByText('Deliverability Health')).toBeInTheDocument();
      expect(
        screen.getByText('Monitor your sender reputation and email deliverability metrics')
      ).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero bounce and complaint rates', () => {
      render(<DeliverabilityHealthCard bounceRate={0} complaintRate={0} />);

      expect(screen.getByText('Excellent')).toBeInTheDocument();
      expect(screen.getByText('0.0%')).toBeInTheDocument();
      expect(screen.getByText('0.00%')).toBeInTheDocument();
    });

    it('should handle very high bounce rate (>100%)', () => {
      render(<DeliverabilityHealthCard bounceRate={150} complaintRate={0.05} />);

      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('150.0%')).toBeInTheDocument();
    });

    it('should handle very high complaint rate', () => {
      render(<DeliverabilityHealthCard bounceRate={3.0} complaintRate={1.5} />);

      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('1.50%')).toBeInTheDocument();
    });

    it('should handle empty complaint details array', () => {
      render(
        <DeliverabilityHealthCard
          bounceRate={3.0}
          complaintRate={0.05}
          complaintDetails={[]}
        />
      );

      expect(screen.queryByText(/complaints received/)).not.toBeInTheDocument();
    });
  });
});
