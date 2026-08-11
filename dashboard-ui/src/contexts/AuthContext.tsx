/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import {
  AUTH_KEY,
  claims,
  confirmSignUp as rscConfirmSignUp,
  getFreshIdToken,
  isSignedIn,
  onAuthChange,
  readSession,
  resendConfirmationCode,
  signIn as rscSignIn,
  signOut as rscSignOut,
  signUp as rscSignUp,
} from '@readysetcloud/ui/auth';
import type { IdClaims } from '@readysetcloud/ui/auth';

interface User {
  userId: string;
  email: string;
  emailVerified: boolean;
  groups?: string[];
  tenantId?: string;
  role?: string;
  isAdmin?: boolean;
  isTenantAdmin?: boolean;
  profileCompleted?: boolean;
  firstName?: string;
  lastName?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * True when the session ended on its own — an id token that could not be
   * renewed, or a 401 from the API — rather than because the user signed out.
   * The login page reads this so an expired session explains itself instead of
   * silently re-rendering the form.
   */
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ isSignUpComplete: boolean; nextStep?: unknown }>;
  confirmSignUp: (email: string, confirmationCode: string) => Promise<void>;
  resendSignUpCode: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

const userFromClaims = (idClaims: IdClaims): User | null => {
  if (!idClaims.sub) return null;
  return {
    userId: idClaims.sub,
    email: idClaims.email || '',
    emailVerified: idClaims.email_verified === true || idClaims.email_verified === 'true',
    tenantId: idClaims['custom:tenant_id'] as string | undefined,
    role: idClaims['custom:role'] as string | undefined,
    isAdmin: idClaims['custom:role'] === 'admin',
    isTenantAdmin: idClaims['custom:role'] === 'tenant_admin',
    profileCompleted: idClaims['custom:profile_completed'] === 'true',
    groups: (idClaims['cognito:groups'] as string[] | undefined) || [],
    firstName: idClaims.given_name,
    lastName: idClaims.family_name,
  };
};

export function AuthProvider({ children }: AuthProviderProps) {
  // The rsc:auth session is read synchronously from localStorage, so auth
  // state is known from the first render — no mount-time loading phase.
  const [user, setUser] = useState<User | null>(() => userFromClaims(claims()));
  const [isAuthenticated, setIsAuthenticated] = useState(() => isSignedIn());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // `isSignedIn()` only reports that tokens are *stored*, not that they still
  // work, so a stored session starts out unverified. Holding the routes until
  // the first refresh settles keeps a dead session from flashing the dashboard
  // on its way back to the login page.
  const [isRestoring, setIsRestoring] = useState(() => isSignedIn());

  // Tells "the session went away" apart from "the user pressed Sign Out" —
  // only the former owes the login page an explanation.
  const wasSignedIn = useRef(isAuthenticated);
  const signingOut = useRef(false);

  useEffect(() => {
    // Sign-in/out in this tab or another one (storage events) re-syncs state.
    return onAuthChange(() => {
      const signedIn = isSignedIn();
      if (signedIn) {
        setSessionExpired(false);
      } else if (wasSignedIn.current && !signingOut.current) {
        setSessionExpired(true);
      }
      wasSignedIn.current = signedIn;
      signingOut.current = false;
      setUser(userFromClaims(claims()));
      setIsAuthenticated(signedIn);
    });
  }, []);

  useEffect(() => {
    if (!isSignedIn()) return;

    // Revalidate the stored session once per load. An id token that has merely
    // aged out is renewed here from the refresh token; one that cannot be
    // renewed is cleared by @readysetcloud/ui, which fires the listener above
    // and drops us to signed-out. Without this pass every route believes a dead
    // session, every request 401s, and /login bounces straight back into a
    // protected route — the silent redirect loop.
    let cancelled = false;
    void (async () => {
      try {
        await getFreshIdToken();
      } catch (err) {
        // A refresh that fails on the network leaves the session in place and
        // is retried by the next request; only a rejected refresh clears it.
        console.error('Error restoring session:', err);
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      setSessionExpired(false);

      const result = await rscSignIn(email, password);
      if (result.kind === 'newPasswordRequired') {
        setError('New password required. Please contact administrator.');
        return;
      }
      // Success updates state via onAuthChange. A session the browser refused
      // to keep — blocked site data, Safari's private mode — throws
      // `SessionNotPersisted` out of rscSignIn as of @readysetcloud/ui 0.7.1
      // rather than reporting a success with nothing behind it, so the catch
      // below has the message to show.
    } catch (error: unknown) {
      console.error('Sign in error:', error);
      setError(getErrorMessage(error) || 'An error occurred during sign in');
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setIsLoading(true);
      signingOut.current = true;
      await rscSignOut();
      setError(null);
      setSessionExpired(false);
    } catch (error: unknown) {
      console.error('Sign out error:', error);
      setError('Error signing out');
    } finally {
      signingOut.current = false;
      setIsLoading(false);
    }
  };

  const getToken = async (): Promise<string> => {
    const token = await getFreshIdToken();
    if (!token) {
      throw new Error('Failed to get authentication token');
    }
    return token;
  };

  const refreshUser = async () => {
    try {
      // Force a token refresh so new claims (e.g. custom:tenant_id set during
      // onboarding) show up: mark the session expired, then ask for a fresh
      // token. Candidate for a first-class forceRefresh in @readysetcloud/ui.
      const session = readSession();
      if (session?.refreshToken) {
        localStorage.setItem(AUTH_KEY, JSON.stringify({ ...session, expiresAt: 0 }));
        await getFreshIdToken();
      }
      setUser(userFromClaims(claims()));
      setIsAuthenticated(isSignedIn());
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    try {
      setIsLoading(true);
      setError(null);

      await rscSignUp(firstName, lastName, email, password);

      // The shared pool always verifies email with a code before sign-in.
      return { isSignUpComplete: false };
    } catch (error: unknown) {
      console.error('Sign up error:', error);
      setError(getErrorMessage(error) || 'An error occurred during sign up');
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const confirmSignUp = async (email: string, confirmationCode: string) => {
    try {
      setIsLoading(true);
      setError(null);

      await rscConfirmSignUp(email, confirmationCode);
    } catch (error: unknown) {
      console.error('Confirm sign up error:', error);
      setError(getErrorMessage(error) || 'An error occurred during confirmation');
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const resendSignUpCode = async (email: string) => {
    try {
      setIsLoading(true);
      setError(null);

      await resendConfirmationCode(email);
    } catch (error: unknown) {
      console.error('Resend code error:', error);
      setError(getErrorMessage(error) || 'An error occurred while resending code');
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const clearError = () => {
    setError(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated,
    // Restoring a stored session is a loading state as far as the routes are
    // concerned: they must not decide where to send anyone until it settles.
    isLoading: isLoading || isRestoring,
    error,
    sessionExpired,
    signIn,
    signUp,
    confirmSignUp,
    resendSignUpCode,
    signOut,
    getToken,
    refreshUser,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

function getErrorMessage(error: unknown): string | undefined {
  // AuthError from @readysetcloud/ui/auth already carries friendly copy
  // (invalid credentials, expired codes, throttling, ...).
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}
