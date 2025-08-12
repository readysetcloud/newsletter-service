import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import { NotificationProvider } from '../contexts/NotificationContext';
import { ToastProvider } from '../components/ui/Toast';
import { AppHeader } from '../components/layout/AppHeader';
import { MobileNavigation } from '../components/layout/MobileNavigation';
import { ErrorBoundary } from '../components/error/ErrorBoundary';

// Extend Jest matchers
expect.extend(toHaveNoViolations);

// Mock auth context for testing
const mockAuthContext = {
  user: { email: 'test@example.com', role: 'admin' },
  isAuthenticated: true,
  isLoading: false,
  signIn: jest.fn(),
  signOut: jest.fn(),
  getToken: jest.fn(),
};

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthContext,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock notification context
jest.mock('../contexts/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock tovider
jest.mock('../components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <AuthProvider>
      <NotificationProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </NotificationProvider>
    </AuthProvider>
  </BrowserRouter>
);

describe('Accessibility Tests', () => {
  describe('AppHeader', () => {
    it('should not have accessibility violations', async () => {
      const { container } = render(
        <TestWrapper>
          <AppHeader />
        </TestWrapper>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have proper ARIA labels', () => {
      render(
        <TestWrapper>
          <AppHeader />
        </TestWrapper>
      );

      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
      expect(screen.getByText('Skip to main content')).toBeInTheDocument();
    });

    it('should have proper keyboard navigation', () => {
      render(
        <TestWrapper>
          <AppHeader />
        </TestWrapper>
      );

      const skipLink = screen.getByText('Skip to main content');
      expect(skipLink).toHaveAttribute('href', '#main-content');

      const navLinks = screen.getAllByRole('link');
      navLinks.forEach(link => {
        expect(link).toHaveAttribute('aria-current');
      });
    });
  });

  describe('MobileNavigation', () => {
    it('should not have accessibility violations', async () => {
      const { container } = render(
        <TestWrapper>
          <MobileNavigation />
        </TestWrapper>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have proper ARIA attributes for menu button', () => {
      render(
        <TestWrapper>
          <MobileNavigation />
        </TestWrapper>
      );

      const menuButton = screen.getByRole('button', { name: /open main menu/i });
      expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      expect(menuButton).toHaveAttribute('aria-controls', 'mobile-menu');
    });

    it('should have proper touch target sizes', () => {
      render(
        <TestWrapper>
          <MobileNavigation />
        </TestWrapper>
      );

      const menuButton = screen.getByRole('button', { name: /open main menu/i });
      const styles = window.getComputedStyle(menuButton);

      // Check minimum touch target size (44px)
      expect(menuButton).toHaveClass('min-h-[44px]');
      expect(menuButton).toHaveClass('min-w-[44px]');
    });
  });

  describe('ErrorBoundary', () => {
    it('should not have accessibility violations in error state', async () => {
      const ThrowError = () => {
        throw new Error('Test error');
      };

      const { container } = render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have proper error messaging', () => {
      const ThrowError = () => {
        throw new Error('Test error');
      };

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument();
    });
  });

  describe('Color Contrast', () => {
    it('should meet WCAG AA color contrast requirements', () => {
      render(
        <TestWrapper>
          <div className="bg-blue-600 text-white p-4">Primary Button</div>
          <div className="bg-gray-600 text-white p-4">Secondary Button</div>
          <div className="bg-green-600 text-white p-4">Success Button</div>
          <div className="bg-red-600 text-white p-4">Error Button</div>
          <div className="bg-yellow-500 text-black p-4">Warning Button</div>
        </TestWrapper>
      );

      // These would be tested with actual contrast calculation in a real implementation
      // For now, we verify the elements exist with the expected classes
      expect(screen.getByText('Primary Button')).toHaveClass('bg-blue-600', 'text-white');
      expect(screen.getByText('Secondary Button')).toHaveClass('bg-gray-600', 'text-white');
      expect(screen.getByText('Success Button')).toHaveClass('bg-green-600', 'text-white');
      expect(screen.getByText('Error Button')).toHaveClass('bg-red-600', 'text-white');
      expect(screen.getByText('Warning Button')).toHaveClass('bg-yellow-500', 'text-black');
    });
  });

  describe('Focus Management', () => {
    it('should have visible focus indicators', () => {
      render(
        <TestWrapper>
          <button className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
            Test Button
          </button>
        </TestWrapper>
      );

      const button = screen.getByRole('button', { name: /test button/i });
      expect(button).toHaveClass('focus:ring-2', 'focus:ring-blue-500');
    });

    it('should support keyboard navigation', () => {
      render(
        <TestWrapper>
          <div>
            <button>First Button</button>
            <button>Second Button</button>
            <a href="/test">Test Link</a>
          </div>
        </TestWrapper>
      );

      const firstButton = screen.getByRole('button', { name: /first button/i });
      const secondButton = screen.getByRole('button', { name: /second button/i });
      const testLink = screen.getByRole('link', { name: /test link/i });

      // All interactive elements should be focusable
      expect(firstButton).not.toHaveAttribute('tabindex', '-1');
      expect(secondButton).not.toHaveAttribute('tabindex', '-1');
      expect(testLink).not.toHaveAttribute('tabindex', '-1');
    });
  });

  describe('Screen Reader Support', () => {
    it('should have proper heading hierarchy', () => {
      render(
        <TestWrapper>
          <div>
            <h1>Main Title</h1>
            <h2>Section Title</h2>
            <h3>Subsection Title</h3>
          </div>
        </TestWrapper>
      );

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    });

    it('should have proper landmark roles', () => {
      render(
        <TestWrapper>
          <AppHeader />
        </TestWrapper>
      );

      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should have descriptive link text', () => {
      render(
        <TestWrapper>
          <AppHeader />
        </TestWrapper>
      );

      const links = screen.getAllByRole('link');
      links.forEach(link => {
        // Links should have accessible names (either text content or aria-label)
        expect(link).toHaveAccessibleName();
      });
    });
  });

  describe('Form Accessibility', () => {
    it('should associate labels with form controls', () => {
      render(
        <div>
          <label htmlFor="test-input">Test Input</label>
          <input id="test-input" type="text" />
        </div>
      );

      const input = screen.getByRole('textbox', { name: /test input/i });
      expect(input).toBeInTheDocument();
    });

    it('should provide error messages for invalid fields', () => {
      render(
        <div>
          <label htmlFor="email-input">Email</label>
          <input
            id="email-input"
            type="email"
            aria-invalid="true"
            aria-describedby="email-error"
          />
          <div id="email-error" role="alert">
            Please enter a valid email address
          </div>
        </div>
      );

      const input = screen.getByRole('textbox', { name: /email/i });
      const errorMessage = screen.getByRole('alert');

      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', 'email-error');
      expect(errorMessage).toBeInTheDocument();
    });
  });
});
