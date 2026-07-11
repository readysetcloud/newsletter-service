import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';

// --- Mocks ---

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockToggleTheme = vi.fn();
const mockTrapFocus = vi.fn().mockReturnValue(vi.fn());
const mockPreloadRoute = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      userId: 'u-1',
      email: 'test@example.com',
      emailVerified: true,
      firstName: 'Test',
      lastName: 'User',
      role: 'editor',
      isAdmin: false,
      isTenantAdmin: false,
    },
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
    skipLink: {
      className: 'sr-only focus:not-sr-only focus:absolute focus:z-50',
    },
  },
}));

vi.mock('@/utils/lazyImports', () => ({
  preloadRoute: (...args: unknown[]) => mockPreloadRoute(...args),
}));

// --- Helpers ---

function renderShell(children: React.ReactNode = <p>Page content</p>) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppShell>{children}</AppShell>
    </MemoryRouter>,
  );
}

// --- Tests ---

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Requirement 1.1: Renders nav, header, and main content ----

  describe('renders core layout sections', () => {
    it('renders the primary navigation', () => {
      renderShell();
      expect(
        screen.getByRole('navigation', { name: 'Primary navigation' }),
      ).toBeInTheDocument();
    });

    it('renders the header banner', () => {
      renderShell();
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('renders the main content area', () => {
      renderShell();
      expect(screen.getByRole('main')).toBeInTheDocument();
    });
  });

  // ---- Side-nav layout ----

  describe('side-nav layout', () => {
    it('renders AppNav in the vertical (side) layout', () => {
      renderShell();
      expect(screen.getByRole('banner').className).toContain('app-nav-side');
    });

    it('renders grouped section headings', () => {
      renderShell();
      // Section labels come from NAV_ITEMS `group` values.
      expect(screen.getByText('Publish')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Monetization')).toBeInTheDocument();
    });

    it('renders nav items as client-side router links', () => {
      renderShell();
      const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
      const issues = within(nav).getByRole('link', { name: /Issues/ });
      // React Router Link renders a real anchor with a resolved href.
      expect(issues).toHaveAttribute('href', '/issues');
    });

    it('marks the active route with aria-current', () => {
      renderShell();
      const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
      const dashboard = within(nav).getByRole('link', { name: /Dashboard/ });
      expect(dashboard).toHaveAttribute('aria-current', 'page');
    });
  });

  // ---- Requirement 1.3: Main content has id="main-content" ----

  describe('main content landmark', () => {
    it('main element has id="main-content"', () => {
      renderShell();
      const main = screen.getByRole('main');
      expect(main).toHaveAttribute('id', 'main-content');
    });
  });

  // ---- Children rendering ----

  describe('children rendering', () => {
    it('renders children inside the main content area', () => {
      renderShell(<div data-testid="child-content">Hello world</div>);
      const main = screen.getByRole('main');
      expect(main).toContainElement(screen.getByTestId('child-content'));
    });
  });

  // ---- Outer div styling ----

  describe('outer div styling', () => {
    it('outer div has min-h-screen bg-background classes', () => {
      const { container } = renderShell();
      const outerDiv = container.firstElementChild as HTMLElement;
      expect(outerDiv.className).toContain('min-h-screen');
      expect(outerDiv.className).toContain('bg-background');
    });
  });
});
