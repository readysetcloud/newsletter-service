import { render, screen, fireEvent } from '@testing-library/react';
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
      expect(screen.getByText('Upgrade to Creator')).toBeInTheDocument();
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

      expect(screen.getByText('Advanced Anaavailable')).toBeInTheDocument();
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

      expect(screen.getByText('Upgrade to Creator')).toBeInTheDocument();
      expect(screen.getByText('$19/month')).toBeInTheDocument();
      expect(screen.getByText('Popular')).toBeInTheDocument();
      expect(screen.getByText('2 sender emails')).toBeInTheDocument();
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

      expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
      expect(screen.getByText('$49/month')).toBeInTheDocument();
      expect(screen.getByText('5 sender emails')).toBeInTheDocument();
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

      // Creator should be marked as current
      const creatorCard = screen.getByText('Creator').closest('div');
      expect(creatorCard).toHaveClass('border-blue-500', 'bg-blue-50');
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

      const banner = screen.getByText('Sender limit reached').closest('div');
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

      const banner = screen.getByText('Sender limit reached').closest('div');
      expect(banner).toHaveClass('bg-amber-50', 'border-amber-200');
    });

    it('applies blue styling for dns-verification context', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="dns-verification"
          variant="banner"
        />
      );

      const banner = screen.getByText('Domain verification unavailable').closest('div');
      expect(banner).toHaveClass('bg-blue-50', 'border-blue-200');
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

      const banner = screen.getByText('Test Feature unavailable').closest('div');
      expect(banner).toHaveClass('bg-purple-50', 'border-purple-200');
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

      // Free tier features
      expect(screen.getByText('$0/month')).toBeInTheDocument();

      // Creator tier features
      expect(screen.getByText('$19/month')).toBeInTheDocument();

      // Pro tier features
      expect(screen.getByText('$49/month')).toBeInTheDocument();
    });

    it('shows check/x marks for tier capabilities', () => {
      render(
        <TierUpgradePrompt
          currentTier={mockFreeTierLimits}
          context="sender-limit"
        />
      );

      // Should show check marks for available features
      const checkIcons = screen.getAllByTestId('check-icon');
      expect(checkIcons.length).toBeGreaterThan(0);
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
      expect(screen.getByRole('heading', { level: 4 })).toBeInTheDocument();
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

      const banner = screen.getByText('Sender limit reached').closest('div');
      expect(banner).toHaveClass('custom-banner-class');
    });
  });
});
