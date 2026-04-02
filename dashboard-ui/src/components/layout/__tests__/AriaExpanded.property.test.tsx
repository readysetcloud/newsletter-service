// Feature: dashboard-ux-overhaul, Property 8: aria-expanded reflects dropdown open state
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AvatarMenu } from '../AvatarMenu';

// Mock AuthContext
const mockSignOut = vi.fn().mockResolvedValue(undefined);
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      userId: 'test-user-id',
      email: 'test@example.com',
      emailVerified: true,
      firstName: 'Test',
      lastName: 'User',
      role: 'admin',
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

// Mock useTheme
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light' as const,
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

type Action = 'click' | 'escape' | 'outsideClick';

function renderAvatarMenu() {
  return render(
    <MemoryRouter>
      <div>
        <div data-testid="outside-area">Outside</div>
        <AvatarMenu />
      </div>
    </MemoryRouter>,
  );
}

/**
 * **Validates: Requirements 9.3**
 *
 * Property 8: aria-expanded reflects dropdown open state
 *
 * For any sequence of open/close interactions on the AvatarMenu,
 * the `aria-expanded` attribute on the AvatarMenu button must always
 * equal the current boolean open state of the dropdown.
 * When the dropdown is open, `aria-expanded` is `"true"`;
 * when closed, `aria-expanded` is `"false"`.
 */
describe('AvatarMenu aria-expanded - Property-Based Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const actionSequenceGen = fc.array(
    fc.constantFrom<Action>('click', 'escape', 'outsideClick'),
    { minLength: 1, maxLength: 10 },
  );

  describe('Property 8: aria-expanded reflects dropdown open state', () => {
    it('aria-expanded always matches the current open state after any action sequence', () => {
      fc.assert(
        fc.property(actionSequenceGen, (actions) => {
          const { unmount } = renderAvatarMenu();

          const button = screen.getByRole('button', { name: 'User menu' });

          // Initial state: dropdown is closed
          let expectedOpen = false;
          expect(button.getAttribute('aria-expanded')).toBe('false');

          for (const action of actions) {
            switch (action) {
              case 'click':
                fireEvent.click(button);
                expectedOpen = !expectedOpen;
                break;
              case 'escape':
                if (expectedOpen) {
                  fireEvent.keyDown(document, { key: 'Escape' });
                  expectedOpen = false;
                }
                break;
              case 'outsideClick':
                if (expectedOpen) {
                  fireEvent.mouseDown(document.body);
                  expectedOpen = false;
                }
                break;
            }

            expect(button.getAttribute('aria-expanded')).toBe(
              String(expectedOpen),
            );
          }

          unmount();
        }),
        { numRuns: 100 },
      );
    });
  });
});
