/**
 * Regression tests for the signed-out redirect loop.
 *
 * A stored `rsc:auth` session only means tokens exist — not that they work. The
 * app used to take that at face value, so an id token that could no longer be
 * refreshed left every route believing the user was signed in while every
 * request 401'd, and the login page redirected straight back into a protected
 * route. These cover the two halves of the fix: the session is revalidated on
 * load, and a sign-in that fails to persist reports itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

const mocks = vi.hoisted(() => ({
  isSignedIn: vi.fn(() => false),
  claims: vi.fn(() => ({}) as Record<string, unknown>),
  getFreshIdToken: vi.fn(async () => 'token' as string | null),
  signIn: vi.fn(async () => ({ kind: 'success' as const })),
  signOut: vi.fn(async () => {}),
}));

vi.mock('@readysetcloud/ui/auth', () => ({
  AUTH_KEY: 'rsc:auth',
  claims: () => mocks.claims(),
  confirmSignUp: vi.fn(),
  getFreshIdToken: () => mocks.getFreshIdToken(),
  isSignedIn: () => mocks.isSignedIn(),
  onAuthChange: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  readSession: vi.fn(() => null),
  resendConfirmationCode: vi.fn(),
  signIn: (email: string, password: string) => mocks.signIn(email, password),
  signOut: () => mocks.signOut(),
  signUp: vi.fn(),
}));

function AuthProbe() {
  const { isAuthenticated, isLoading, sessionExpired, error, signIn } = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="expired">{String(sessionExpired)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <button onClick={() => void signIn('user@example.com', 'password1')}>sign in</button>
    </div>
  );
}

const renderAuth = () => render(<AuthProvider><AuthProbe /></AuthProvider>);

beforeEach(() => {
  listeners.clear();
  vi.clearAllMocks();
  mocks.isSignedIn.mockReturnValue(false);
  mocks.claims.mockReturnValue({});
  mocks.getFreshIdToken.mockResolvedValue('token');
  mocks.signIn.mockResolvedValue({ kind: 'success' });
  mocks.signOut.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthProvider session restore', () => {
  it('holds the routes while a stored session is being revalidated', async () => {
    mocks.isSignedIn.mockReturnValue(true);
    let settle: (token: string | null) => void = () => {};
    mocks.getFreshIdToken.mockReturnValue(new Promise(resolve => { settle = resolve; }));

    renderAuth();

    // Guards must not route anyone on an unverified session.
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await act(async () => { settle('fresh-token'); });

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('drops to signed-out when the stored session cannot be refreshed', async () => {
    mocks.isSignedIn.mockReturnValue(true);
    mocks.getFreshIdToken.mockImplementation(async () => {
      // What @readysetcloud/ui does with a refresh token the pool rejects.
      mocks.isSignedIn.mockReturnValue(false);
      mocks.claims.mockReturnValue({});
      notify();
      return null;
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    // ...and the login page gets something to say about it.
    expect(screen.getByTestId('expired')).toHaveTextContent('true');
  });

  it('does not revalidate when there is no stored session', async () => {
    renderAuth();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(mocks.getFreshIdToken).not.toHaveBeenCalled();
    expect(screen.getByTestId('expired')).toHaveTextContent('false');
  });

  it('keeps a session whose refresh failed on the network', async () => {
    mocks.isSignedIn.mockReturnValue(true);
    // No notify(): the library only clears the session when the pool rejects
    // the refresh, so a flaky connection must not sign anyone out.
    mocks.getFreshIdToken.mockResolvedValue(null);

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('expired')).toHaveTextContent('false');
  });
});

describe('AuthProvider sign in', () => {
  it('reports a sign-in whose session did not persist', async () => {
    // Blocked site data / Safari private mode: the write is swallowed, so the
    // session is gone the moment it is read back.
    mocks.signIn.mockResolvedValue({ kind: 'success' });
    mocks.isSignedIn.mockReturnValue(false);

    renderAuth();
    await act(async () => { screen.getByText('sign in').click(); });

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent(/couldn't keep you signed in/i)
    );
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('signs in cleanly when the session sticks', async () => {
    mocks.signIn.mockImplementation(async () => {
      mocks.isSignedIn.mockReturnValue(true);
      mocks.claims.mockReturnValue({ sub: 'u-1', email: 'user@example.com' });
      notify();
      return { kind: 'success' };
    });

    renderAuth();
    await act(async () => { screen.getByText('sign in').click(); });

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
    expect(screen.getByTestId('expired')).toHaveTextContent('false');
  });

  it('does not blame expiry when the user signs out on purpose', async () => {
    mocks.isSignedIn.mockReturnValue(true);
    mocks.claims.mockReturnValue({ sub: 'u-1', email: 'user@example.com' });

    function SignOutProbe() {
      const { sessionExpired, isAuthenticated, signOut } = useAuth();
      return (
        <div>
          <span data-testid="authenticated">{String(isAuthenticated)}</span>
          <span data-testid="expired">{String(sessionExpired)}</span>
          <button onClick={() => void signOut()}>sign out</button>
        </div>
      );
    }

    mocks.signOut.mockImplementation(async () => {
      mocks.isSignedIn.mockReturnValue(false);
      mocks.claims.mockReturnValue({});
      notify();
    });

    render(<AuthProvider><SignOutProbe /></AuthProvider>);
    await act(async () => { screen.getByText('sign out').click(); });

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
    expect(screen.getByTestId('expired')).toHaveTextContent('false');
  });
});
