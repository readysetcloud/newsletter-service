import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppHeaderBar } from '../AppHeaderBar';

// --- Mocks ---

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockToggleTheme = vi.fn();

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

// --- Helpers ---

const mockOnMobileMenuOpen = vi.fn();

/**
 * Render AppHeaderBar at a given route. For nested routes that use useParams,
 * we set up a <Routes> with a matching path so react-router populates params.
 */
function renderAtRoute(route: string) {
  // Determine the route pattern for react-router
  let routePath = '*';
  if (route.match(/^\/issues\/\d+\/edit$/)) {
    routePath = '/issues/:id/edit';
  } else if (route.match(/^\/issues\/\d+$/)) {
    routePath = '/issues/:id';
  } else if (route === '/issues/new') {
    routePath = '/issues/new';
  } else if (route.match(/^\/segments\/.+$/)) {
    routePath = '/segments/:segmentId';
  }

  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path={routePath}
          element={<AppHeaderBar onMobileMenuOpen={mockOnMobileMenuOpen} />}
        />
        {/* Fallback for simple top-level routes */}
        {routePath === '*' ? null : (
          <Route
            path="*"
            element={<AppHeaderBar onMobileMenuOpen={mockOnMobileMenuOpen} />}
          />
        )}
      </Routes>
    </MemoryRouter>,
  );
}

// --- Tests ---

describe('AppHeaderBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Requirement 9.8: Skip-to-content link is first focusable element ----

  describe('skip-to-content link', () => {
    it('renders a skip-to-content link targeting #main-content', () => {
      renderAtRoute('/');
      const skipLink = screen.getByText('Skip to main content');
      expect(skipLink).toBeInTheDocument();
      expect(skipLink.tagName).toBe('A');
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });

    it('skip-to-content link is the first focusable element in the header', () => {
      renderAtRoute('/');
      const header = screen.getByRole('banner');
      const focusable = header.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      expect(focusable.length).toBeGreaterThan(0);
      expect(focusable[0]).toHaveTextContent('Skip to main content');
    });

    it('skip-to-content link has sr-only class', () => {
      renderAtRoute('/');
      const skipLink = screen.getByText('Skip to main content');
      expect(skipLink.className).toContain('sr-only');
    });
  });

  // ---- Requirement 4.4: Hamburger button visible on mobile ----

  describe('hamburger button', () => {
    it('renders a hamburger button with md:hidden class', () => {
      renderAtRoute('/');
      const hamburger = screen.getByRole('button', { name: 'Open navigation menu' });
      expect(hamburger).toBeInTheDocument();
      expect(hamburger.className).toContain('md:hidden');
    });

    it('calls onMobileMenuOpen when hamburger is clicked', () => {
      renderAtRoute('/');
      const hamburger = screen.getByRole('button', { name: 'Open navigation menu' });
      hamburger.click();
      expect(mockOnMobileMenuOpen).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Requirement 4.1: Top-level routes show plain text title ----

  describe('title for top-level routes', () => {
    it('renders "Dashboard" title on /', () => {
      renderAtRoute('/');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    });

    it('renders "Issues" title on /issues', () => {
      renderAtRoute('/issues');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Issues');
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    });

    it('renders "Subscribers" title on /subscribers', () => {
      renderAtRoute('/subscribers');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Subscribers');
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    });

    it('renders "Brand" title on /brand', () => {
      renderAtRoute('/brand');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Brand');
    });

    it('renders "Pricing" title on /pricing', () => {
      renderAtRoute('/pricing');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pricing');
    });
  });

  // ---- Requirement 4.2: Nested routes show breadcrumb ----

  describe('breadcrumb for nested routes', () => {
    it('renders breadcrumb with parent link for /issues/42', () => {
      renderAtRoute('/issues/42');
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumbNav).toBeInTheDocument();

      // Parent link
      const parentLink = screen.getByRole('link', { name: 'Issues' });
      expect(parentLink).toHaveAttribute('href', '/issues');

      // Current page
      expect(screen.getByText('Issue #42')).toBeInTheDocument();
      expect(screen.getByText('Issue #42')).toHaveAttribute('aria-current', 'page');
    });

    it('renders breadcrumb for /issues/7/edit', () => {
      renderAtRoute('/issues/7/edit');
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumbNav).toBeInTheDocument();

      const parentLink = screen.getByRole('link', { name: 'Issues' });
      expect(parentLink).toHaveAttribute('href', '/issues');

      expect(screen.getByText('Edit Issue #7')).toHaveAttribute('aria-current', 'page');
    });

    it('renders breadcrumb for /issues/new', () => {
      renderAtRoute('/issues/new');
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumbNav).toBeInTheDocument();

      const parentLink = screen.getByRole('link', { name: 'Issues' });
      expect(parentLink).toHaveAttribute('href', '/issues');

      expect(screen.getByText('New Issue')).toHaveAttribute('aria-current', 'page');
    });

    it('renders breadcrumb for /segments/abc-123', () => {
      renderAtRoute('/segments/abc-123');
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumbNav).toBeInTheDocument();

      const parentLink = screen.getByRole('link', { name: 'Subscribers' });
      expect(parentLink).toHaveAttribute('href', '/subscribers');

      // Default fallback title for segment
      expect(screen.getByText('Segment')).toHaveAttribute('aria-current', 'page');
    });

    it('does NOT render an h1 heading when breadcrumb is shown', () => {
      renderAtRoute('/issues/42');
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    });

    it('renders chevron separator between breadcrumb items', () => {
      renderAtRoute('/issues/42');
      const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' });
      const separators = breadcrumbNav.querySelectorAll('svg[aria-hidden="true"]');
      expect(separators.length).toBeGreaterThanOrEqual(1);
    });
  });
});
