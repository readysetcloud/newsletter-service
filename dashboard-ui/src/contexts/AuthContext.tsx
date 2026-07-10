/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

  useEffect(() => {
    // Sign-in/out in this tab or another one (storage events) re-syncs state.
    return onAuthChange(() => {
      setUser(userFromClaims(claims()));
      setIsAuthenticated(isSignedIn());
    });
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await rscSignIn(email, password);
      if (result.kind === 'newPasswordRequired') {
        setError('New password required. Please contact administrator.');
      }
      // Success updates state via onAuthChange.
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
      await rscSignOut();
      setError(null);
    } catch (error: unknown) {
      console.error('Sign out error:', error);
      setError('Error signing out');
    } finally {
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
    isLoading,
    error,
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
