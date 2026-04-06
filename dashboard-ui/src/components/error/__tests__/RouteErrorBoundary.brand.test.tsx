import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BRAND, formatPageTitle } from '@/constants/brand';

// Mock useNavigate used by RouteErrorFallback
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('RouteErrorBoundary branding', () => {
  let originalTitle: string;

  beforeEach(() => {
    originalTitle = document.title;
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  // ---- Requirement 5.1: RouteErrorBoundary sets document.title using formatPageTitle with routeName ----

  it('sets document.title to formatPageTitle(routeName) when routeName is provided', async () => {
    const { RouteErrorBoundary } = await import('../RouteErrorBoundary');

    render(
      <MemoryRouter>
        <RouteErrorBoundary routeName="Dashboard">
          <div>Page content</div>
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(document.title).toBe(formatPageTitle('Dashboard'));
    expect(document.title).toBe(`Dashboard | ${BRAND.titleSuffix}`);
  });

  // ---- Requirement 5.2: RouteErrorBoundary sets document.title to titleSuffix when no routeName ----

  it('sets document.title to BRAND.titleSuffix when no routeName is provided', async () => {
    const { RouteErrorBoundary } = await import('../RouteErrorBoundary');

    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <div>Page content</div>
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(document.title).toBe(formatPageTitle());
    expect(document.title).toBe(BRAND.titleSuffix);
  });
});
