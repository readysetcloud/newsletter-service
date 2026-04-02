import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSidebar } from '../AppSidebar';

// --- Mocks ---

const mockPreloadRoute = vi.fn();

vi.mock('@/utils/lazyImports', () => ({
  preloadRoute: (...args: unknown[]) => mockPreloadRoute(...args),
}));

// --- Helpers ---

function renderSidebar(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

// --- Tests ---

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Requirement 2.2: Renders exactly 5 nav items with icons ----

  describe('nav items', () => {
    it('renders exactly 5 navigation links', () => {
      renderSidebar();
      const nav = screen.getByRole('navigation', { name: 'Main navigation' });
      const links = nav.querySelectorAll('a');
      expect(links).toHaveLength(5);
    });

    it('renders the correct nav item labels', () => {
      renderSidebar();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Issues')).toBeInTheDocument();
      expect(screen.getByText('Subscribers')).toBeInTheDocument();
      expect(screen.getByText('Brand')).toBeInTheDocument();
      expect(screen.getByText('Sponsors')).toBeInTheDocument();
    });

    it('renders an icon for each nav item', () => {
      renderSidebar();
      const nav = screen.getByRole('navigation', { name: 'Main navigation' });
      const icons = nav.querySelectorAll('svg[aria-hidden="true"]');
      expect(icons).toHaveLength(5);
    });
  });

  // ---- Requirement 2.3: Does not render account items ----

  describe('account items exclusion', () => {
    it('does NOT render Profile link', () => {
      renderSidebar();
      expect(screen.queryByText('Profile')).not.toBeInTheDocument();
    });

    it('does NOT render Sender Emails link', () => {
      renderSidebar();
      expect(screen.queryByText('Sender Emails')).not.toBeInTheDocument();
      expect(screen.queryByText('Senders')).not.toBeInTheDocument();
    });

    it('does NOT render API Keys link', () => {
      renderSidebar();
      expect(screen.queryByText('API Keys')).not.toBeInTheDocument();
    });

    it('does NOT render Billing link', () => {
      renderSidebar();
      expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    });
  });

  // ---- Requirement 2.4: Active indicator for various routes ----

  describe('active indicator', () => {
    it('marks Dashboard as active on /', () => {
      renderSidebar(['/']);
      const link = screen.getByText('Dashboard').closest('a');
      expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('marks Issues as active on /issues', () => {
      renderSidebar(['/issues']);
      const link = screen.getByText('Issues').closest('a');
      expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('marks Issues as active on /issues/42', () => {
      renderSidebar(['/issues/42']);
      const link = screen.getByText('Issues').closest('a');
      expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('marks Subscribers as active on /subscribers', () => {
      renderSidebar(['/subscribers']);
      const link = screen.getByText('Subscribers').closest('a');
      expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('marks Subscribers as active on /segments/abc', () => {
      renderSidebar(['/segments/abc']);
      const link = screen.getByText('Subscribers').closest('a');
      expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('marks Brand as active on /brand', () => {
      renderSidebar(['/brand']);
      const link = screen.getByText('Brand').closest('a');
      expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('marks Sponsors as active on /pricing', () => {
      renderSidebar(['/pricing']);
      const link = screen.getByText('Sponsors').closest('a');
      expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('does NOT mark Dashboard as active on /issues', () => {
      renderSidebar(['/issues']);
      const link = screen.getByText('Dashboard').closest('a');
      expect(link).not.toHaveAttribute('aria-current', 'page');
    });

    it('marks no item as active on an unknown route', () => {
      renderSidebar(['/profile']);
      const nav = screen.getByRole('navigation', { name: 'Main navigation' });
      const activeLinks = nav.querySelectorAll('[aria-current="page"]');
      expect(activeLinks).toHaveLength(0);
    });
  });

  // ---- Requirement 2.8: preloadRoute called on hover ----

  describe('preloadRoute on hover', () => {
    it('calls preloadRoute with correct key on mouseEnter', () => {
      renderSidebar();
      const issuesLink = screen.getByText('Issues').closest('a')!;
      fireEvent.mouseEnter(issuesLink);
      expect(mockPreloadRoute).toHaveBeenCalledWith('issues');
    });

    it('calls preloadRoute with correct key on focus', () => {
      renderSidebar();
      const subscribersLink = screen.getByText('Subscribers').closest('a')!;
      fireEvent.focus(subscribersLink);
      expect(mockPreloadRoute).toHaveBeenCalledWith('subscribers');
    });
  });
});
