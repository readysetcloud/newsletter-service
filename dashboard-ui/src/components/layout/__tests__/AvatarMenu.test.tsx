import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AvatarMenu } from '../AvatarMenu';

// --- Mocks ---

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockToggleTheme = vi.fn();

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

// --- Helpers ---

function renderMenu() {
  return render(
    <MemoryRouter>
      <div>
        <div data-testid="outside">Outside</div>
        <AvatarMenu />
      </div>
    </MemoryRouter>,
  );
}

function getButton() {
  return screen.getByRole('button', { name: 'User menu' });
}

function openMenu() {
  fireEvent.click(getButton());
}

// --- Tests ---

describe('AvatarMenu', () => {
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

  // ---- Requirement 9.3: ARIA attributes ----

  describe('ARIA attributes', () => {
    it('has aria-haspopup="true" on the trigger button', () => {
      renderMenu();
      expect(getButton()).toHaveAttribute('aria-haspopup', 'true');
    });

    it('has aria-expanded="false" when closed', () => {
      renderMenu();
      expect(getButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('has aria-expanded="true" when open', () => {
      renderMenu();
      openMenu();
      expect(getButton()).toHaveAttribute('aria-expanded', 'true');
    });

    it('renders dropdown with role="menu"', () => {
      renderMenu();
      openMenu();
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('renders menu items with role="menuitem"', () => {
      renderMenu();
      openMenu();
      const items = screen.getAllByRole('menuitem');
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- Requirement 3.3: Opens/closes on click ----

  describe('open and close on click', () => {
    it('opens the dropdown on click', () => {
      renderMenu();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      openMenu();
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('closes the dropdown on a second click', () => {
      renderMenu();
      openMenu();
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.click(getButton());
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  // ---- Requirement 3.9: Closes on Escape and returns focus ----

  describe('close on Escape', () => {
    it('closes the dropdown and returns focus to the button', () => {
      renderMenu();
      openMenu();
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(getButton());
    });
  });

  // ---- Requirement 3.8: Closes on outside click ----

  describe('close on outside click', () => {
    it('closes the dropdown when clicking outside', () => {
      renderMenu();
      openMenu();
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  // ---- Requirement 3.1, 3.10: Renders email and role badge ----

  describe('email and role badge', () => {
    it('displays the user email in the dropdown header', () => {
      renderMenu();
      openMenu();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('displays the user role badge', () => {
      renderMenu();
      openMenu();
      expect(screen.getByText('editor')).toBeInTheDocument();
    });
  });

  // ---- Requirement 9.5: Arrow key navigation ----

  describe('arrow key navigation', () => {
    it('moves focus down with ArrowDown', () => {
      renderMenu();
      openMenu();

      const menu = screen.getByRole('menu');
      const items = screen.getAllByRole('menuitem');

      // Press ArrowDown to focus first item
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[0]);

      // Press ArrowDown again to focus second item
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[1]);
    });

    it('moves focus up with ArrowUp', () => {
      renderMenu();
      openMenu();

      const menu = screen.getByRole('menu');
      const items = screen.getAllByRole('menuitem');

      // Focus second item first
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[1]);

      // ArrowUp should go back to first item
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(items[0]);
    });

    it('wraps around from last to first with ArrowDown', () => {
      renderMenu();
      openMenu();

      const menu = screen.getByRole('menu');
      const items = screen.getAllByRole('menuitem');

      // Navigate to last item
      for (let i = 0; i < items.length; i++) {
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
      }

      // One more ArrowDown should wrap to first
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[0]);
    });
  });

  // ---- Requirement 3.5: Billing link conditional on admin status ----

  describe('Billing link visibility', () => {
    it('does NOT show Billing link for non-admin users', () => {
      mockUser = { ...mockUser, isAdmin: false, isTenantAdmin: false };
      renderMenu();
      openMenu();
      expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    });

    it('shows Billing link when user isAdmin', () => {
      mockUser = { ...mockUser, isAdmin: true, isTenantAdmin: false };
      renderMenu();
      openMenu();
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });

    it('shows Billing link when user isTenantAdmin', () => {
      mockUser = { ...mockUser, isAdmin: false, isTenantAdmin: true };
      renderMenu();
      openMenu();
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });

    it('shows Billing link when user is both isAdmin and isTenantAdmin', () => {
      mockUser = { ...mockUser, isAdmin: true, isTenantAdmin: true };
      renderMenu();
      openMenu();
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });
  });

  // ---- Requirement 3.1: Initials rendering ----

  describe('initials rendering', () => {
    it('renders initials from firstName and lastName', () => {
      renderMenu();
      expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('renders fallback icon when firstName is missing', () => {
      mockUser = { ...mockUser, firstName: undefined };
      renderMenu();
      expect(screen.queryByText('JD')).not.toBeInTheDocument();
      // The button should still render (with a fallback icon)
      expect(getButton()).toBeInTheDocument();
    });
  });

  // ---- Requirement 3.4: Standard menu links present ----

  describe('standard menu links', () => {
    it('renders Profile, Sender Emails, and API Keys links', () => {
      renderMenu();
      openMenu();
      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText('Sender Emails')).toBeInTheDocument();
      expect(screen.getByText('API Keys')).toBeInTheDocument();
    });

    it('renders theme toggle and sign out', () => {
      renderMenu();
      openMenu();
      // Theme toggle shows "Dark mode" when theme is light
      expect(screen.getByText('Dark mode')).toBeInTheDocument();
      expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });
  });
});
