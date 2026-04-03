import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileDrawer } from '../MobileDrawer';

// --- Mocks ---

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockToggleTheme = vi.fn();
const mockTrapFocus = vi.fn().mockReturnValue(vi.fn());

let mockUser: Record<string, unknown> | null = {
  userId: 'u-1',
  email: 'jane@example.com',
  emailVerified: true,
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'editor',
  isAdmin: false,
  isTenantAdmin: false,
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: true,
    isLoading: false,
    error: null,
    signOut: mockSignOut,
    signIn: vi.fn(),
    signUp: vi.fn(),
    confirmSignUp: vi.fn(),
    resendSignUpCode: vi.fn(),
    getToken: vi.fn(),
    refreshUser: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light' as const,
    setTheme: vi.fn(),
    toggleTheme: mockToggleTheme,
  }),
}));

vi.mock('@/utils/accessibility', () => ({
  keyboardUtils: {
    trapFocus: (...args: unknown[]) => mockTrapFocus(...args),
  },
  responsiveA11y: {
    focusRing: {
      className: 'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
    },
  },
}));

// --- Helpers ---

const mockOnClose = vi.fn();

function renderDrawer(isOpen = true) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <MobileDrawer isOpen={isOpen} onClose={mockOnClose} />
    </MemoryRouter>,
  );
}

// --- Tests ---

describe('MobileDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      userId: 'u-1',
      email: 'jane@example.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'editor',
      isAdmin: false,
      isTenantAdmin: false,
    };
  });

  // ---- Requirement 7.1: Opens from left with slide animation ----

  describe('slide animation', () => {
    it('has translate-x-0 class when open', () => {
      renderDrawer(true);
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('translate-x-0');
      expect(dialog.className).not.toContain('-translate-x-full');
    });

    it('has -translate-x-full class when closed', () => {
      renderDrawer(false);
      const dialog = screen.getByRole('dialog', { hidden: true });
      expect(dialog.className).toContain('-translate-x-full');
      expect(dialog.className).not.toContain('translate-x-0');
    });

    it('has transition-transform class for animation', () => {
      renderDrawer(true);
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('transition-transform');
    });

    it('is positioned on the left side of the viewport', () => {
      renderDrawer(true);
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('left-0');
    });
  });

  // ---- Requirement 7.2: Two labeled groups (Navigation, Account) ----

  describe('labeled groups', () => {
    it('renders a "Navigation" group heading', () => {
      renderDrawer(true);
      expect(screen.getByText('Navigation')).toBeInTheDocument();
    });

    it('renders an "Account" group heading', () => {
      renderDrawer(true);
      expect(screen.getByText('Account')).toBeInTheDocument();
    });

    it('renders all 5 navigation items', () => {
      renderDrawer(true);
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Issues')).toBeInTheDocument();
      expect(screen.getByText('Subscribers')).toBeInTheDocument();
      expect(screen.getByText('Brand')).toBeInTheDocument();
      expect(screen.getByText('Sponsors')).toBeInTheDocument();
    });

    it('renders account items (Profile, Sender Emails, API Keys)', () => {
      renderDrawer(true);
      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText('Sender Emails')).toBeInTheDocument();
      expect(screen.getByText('API Keys')).toBeInTheDocument();
    });

    it('conditionally shows Billing for admin users', () => {
      mockUser = { ...mockUser, isAdmin: true };
      renderDrawer(true);
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });

    it('hides Billing for non-admin users', () => {
      mockUser = { ...mockUser, isAdmin: false, isTenantAdmin: false };
      renderDrawer(true);
      expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    });
  });

  // ---- Requirement 7.8: Focus trap when open ----

  describe('focus trap', () => {
    it('calls trapFocus when the drawer is open', async () => {
      renderDrawer(true);
      // trapFocus is called inside a requestAnimationFrame, so we need to flush it
      await vi.waitFor(() => {
        expect(mockTrapFocus).toHaveBeenCalled();
      });
    });

    it('does not call trapFocus when the drawer is closed', () => {
      renderDrawer(false);
      expect(mockTrapFocus).not.toHaveBeenCalled();
    });
  });

  // ---- Requirement 7.6: Closes on link click ----

  describe('closes on link click', () => {
    it('calls onClose when a navigation link is clicked', () => {
      renderDrawer(true);
      fireEvent.click(screen.getByText('Issues'));
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when an account link is clicked', () => {
      renderDrawer(true);
      fireEvent.click(screen.getByText('Profile'));
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  // ---- Requirement 7.7: Closes on Escape ----

  describe('closes on Escape', () => {
    it('calls onClose when Escape key is pressed', () => {
      renderDrawer(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('does not call onClose on Escape when drawer is closed', () => {
      renderDrawer(false);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  // ---- Additional: backdrop and close button ----

  describe('backdrop and close button', () => {
    it('renders backdrop overlay when open', () => {
      const { container } = renderDrawer(true);
      const backdrop = container.querySelector('.bg-black\\/50');
      expect(backdrop).toBeInTheDocument();
    });

    it('does not render backdrop when closed', () => {
      const { container } = renderDrawer(false);
      const backdrop = container.querySelector('.bg-black\\/50');
      expect(backdrop).not.toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      renderDrawer(true);
      const closeBtn = screen.getByRole('button', { name: 'Close navigation' });
      fireEvent.click(closeBtn);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  // ---- Renders nothing when no user ----

  describe('no user', () => {
    it('renders nothing when user is null', () => {
      mockUser = null;
      const { container } = renderDrawer(true);
      expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    });
  });
});
