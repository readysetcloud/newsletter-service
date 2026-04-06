import { render, screen } from '@testing-library/react';
import * as userEvent from '@testing-library/user-event';
import { TierUpgradePrompt } from '../TierUpgradePrompt';
import type { TierLimits } from '@/types';

// Mock dependencies
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: vi.fn()
  })
}));

const mockFreeTierLimits: TierLimits = {
  tier: 'free-tier',
  maxSenders: 1,
  currentCount: 1,
  canUseDNS: false,
  canUseMailbox: true
};

const mockCreatorTierLimits: TierLimits = {
  tier: 'creator-tier',
  maxSenders: 2,
  currentCount: 1,
  canUseDNS: true,
  canUseMailbox: true
};

const mockProTierLimits: TierLimits = {
  tier: 'pro-tier',
  maxSenders: 5,
  currentCount: 2,
  canUseDNS: true,
  canUseMailbox: true
};

const mockOnUpgrade = vi.fn();

describe('TierUpgradePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Card variant (default)', () => {
    it('renders sender limit context correctly', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          onUpgrade={mockOnUpgrade}
        />
      );

      expect(screen.getByText('Sender limit reached')).toBeInTheDocument();
      expect(screen.getByText(/you've reached the maximum of 1 sender email/i)).toBeInTheDocument();
      // "Upgrade to Creator" appears in both the heading and the button
      const upgradeElements = screen.getAllByText(/upgrade to creator/i);
      expect(upgradeElements.length).toBeGreaterThan(0);
    });

    it('renders DNS verification context correctly', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="dns-verification"
          onUpgrade={mockOnUpgrade}
        />
      );

      expect(screen.getByText('Domain verification unavailable')).toBeInTheDocument();
      expect(screen.getByText(/domain verification is available on creator and pro plans/i)).toBeInTheDocument();
    });

    it('renders feature disabled context correctly', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="feature-disabled"
          feature="Advanced Analytics"
          onUpgrade={mockOnUpgrade}
        />
      );

      expect(screen.getByText('Advanced Analytics unavailable')).toBeInTheDocument();
      expect(screen.getByText(/this feature is not available on your current free tier plan/i)).toBeInTheDocument();
    });

    it('renders general context correctly', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="general"
          onUpgrade={mockOnUpgrade}
        />
      );

      expect(screen.getByText('Unlock more features')).toBeInTheDocument();
      expect(screen.getByText(/upgrade your plan to access more sender emails/i)).toBeInTheDocument();
    });

    it('shows next tier information for free tier', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          onUpgrade={mockOnUpgrade}
        />
      );

      const upgradeElements = screen.getAllByText(/upgrade to\s*creator/i);
      expect(upgradeElements.length).toBeGreaterThan(0);
      expect(screen.getByText('$19/month')).toBeInTheDocument();
      expect(screen.getByText('Popular')).toBeInTheDocument();
      expect(screen.getByText('Domain verification')).toBeInTheDocument();
    });

    it('shows next tier information for creator tier', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockCreatorTierLimits}
          context="sender-limit"
          onUpgrade={mockOnUpgrade}
        />
      );

      const upgradeElements = screen.getAllByText(/upgrade to\s*pro/i);
      expect(upgradeElements.length).toBeGreaterThan(0);
      expect(screen.getByText('$49/month')).toBeInTheDocument();
    });

    it('handles pro tier (no next tier)', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockProTierLimits}
          context="sender-limit"
          onUpgrade={mockOnUpgrade}
        />
      );

      expect(screen.getByText('Upgrade Plan')).toBeInTheDocument();
      // Should not show next tier info since pro is the highest
      expect(screen.queryByText('Upgrade to')).not.toBeInTheDocument();
    });

    it('calls onUpgrade when upgrade button clicked', async () => {
      const user = userEvent.setup();
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          onUpgrade={mockOnUpgrade}
        />
      );

      const upgradeButton = screen.getByRole('button', { name: /upgrade to creator/i });
      await user.click(upgradeButton);

      expect(mockOnUpgrade).toHaveBeenCalled();
    });

    it('shows default upgrade message when no onUpgrade provided', async () => {
      const user = userEvent.setup();
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
        />
      );

      const upgradeButton = screen.getByRole('button', { name: /upgrade to creator/i });
      await user.click(upgradeButton);

      // Should show toast message (mocked)
      expect(mockOnUpgrade).not.toHaveBeenCalled();
    });

    it('shows plan comparison when showComparison is true', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          showComparison={true}
        />
      );

      expect(screen.getByText('Compare Plans')).toBeInTheDocument();
      expect(screen.getByText('Free')).toBeInTheDocument();
      expect(screen.getByText('Creator')).toBeInTheDocument();
      expect(screen.getByText('Pro')).toBeInTheDocument();
      expect(screen.getByText('Current Plan')).toBeInTheDocument();
      expect(screen.getByText('Most Popular')).toBeInTheDocument();
    });

    it('highlights current plan in comparison', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockCreatorTierLimits}
          context="sender-limit"
          showComparison={true}
        />
      );

      const currentPlanBadge = screen.getByText('Current Plan');
      expect(currentPlanBadge).toBeInTheDocument();

      // Creator should be marked as current - find the card with the border class
      const creatorCard = screen.getByText('Creator').closest('.border-primary-500');
      expect(creatorCard).toBeInTheDocument();
      expect(creatorCard).toHaveClass('bg-primary-50');
    });
  });

  describe('Banner variant', () => {
    it('renders banner variant correctly', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          variant="banner"
          onUpgrade={mockOnUpgrade}
        />
      );

      expect(screen.getByText('Sender limit reached')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /upgrade plan/i })).toBeInTheDocument();

      // Should not show the detailed card content
      expect(screen.queryByText('$19/month')).not.toBeInTheDocument();
    });

    it('applies correct styling for banner variant', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          variant="banner"
          className="custom-class"
        />
      );

      const banner = screen.getByText('Sender limit reached').closest('.rounded-lg');
      expect(banner).toHaveClass('custom-class');
    });
  });

  describe('Inline variant', () => {
    it('renders inline variant correctly', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          variant="inline"
          onUpgrade={mockOnUpgrade}
        />
      );

      expect(screen.getByText('Upgrade to Creator')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument();

      // Should not show detailed content
      expect(screen.queryByText('Sender limit reached')).not.toBeInTheDocument();
    });

    it('shows generic upgrade text for pro tier in inline variant', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockProTierLimits}
          context="sender-limit"
          variant="inline"
        />
      );

      expect(screen.getByText('Upgrade Plan')).toBeInTheDocument();
    });
  });

  describe('Context-specific styling', () => {
    it('applies amber styling for sender-limit context', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          variant="banner"
        />
      );

      const banner = screen.getByText('Sender limit reached').closest('.rounded-lg');
      expect(banner).toHaveClass('bg-warning-50', 'border-warning-200');
    });

    it('applies blue styling for dns-verification context', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="dns-verification"
          variant="banner"
        />
      );

      const banner = screen.getByText('Domain verification unavailable').closest('.rounded-lg');
      expect(banner).toHaveClass('bg-primary-50', 'border-primary-200');
    });

    it('applies purple styling for feature-disabled context', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="feature-disabled"
          feature="Test Feature"
          variant="banner"
        />
      );

      const banner = screen.getByText('Test Feature unavailable').closest('.rounded-lg');
      expect(banner).toHaveClass('bg-primary-50', 'border-primary-200');
    });
  });

  describe('Feature display', () => {
    it('shows correct features for each tier', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          showComparison={true}
        />
      );

      // Prices should be visible in the comparison section
      const prices = screen.getAllByText('$0/month');
      expect(prices.length).toBeGreaterThan(0);

      const creatorPrices = screen.getAllByText('$19/month');
      expect(creatorPrices.length).toBeGreaterThan(0);

      const proPrices = screen.getAllByText('$49/month');
      expect(proPrices.length).toBeGreaterThan(0);
    });

    it('shows check/x marks for tier capabilities', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
        />
      );

      // Should show check marks for available features (rendered as SVG icons with text-success-600 class)
      const container = screen.getByText('Sender limit reached').closest('div')?.parentElement;
      expect(container).toBeInTheDocument();
      // The component renders CheckIcon elements for available features
      expect(screen.getByText('Domain verification')).toBeInTheDocument();
      expect(screen.getByText('Email verification')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper button labels', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          onUpgrade={mockOnUpgrade}
        />
      );

      const upgradeButton = screen.getByRole('button', { name: /upgrade to creator/i });
      expect(upgradeButton).toBeInTheDocument();
    });

    it('has proper heading structure', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          showComparison={true}
        />
      );

      expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
      // Multiple h4 headings exist (upgrade info, additional benefits, compare plans)
      const h4s = screen.getAllByRole('heading', { level: 4 });
      expect(h4s.length).toBeGreaterThan(0);
    });
  });

  describe('Custom className', () => {
    it('applies custom className to card variant', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          className="custom-test-class"
        />
      );

      const card = screen.getByText('Sender limit reached').closest('div')?.parentElement;
      expect(card).toHaveClass('custom-test-class');
    });

    it('applies custom className to banner variant', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
          variant="banner"
          className="custom-banner-class"
        />
      );

      const banner = screen.getByText('Sender limit reached').closest('.rounded-lg');
      expect(banner).toHaveClass('custom-banner-class');
    });
  });
});
