/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendSignUpCode,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth';

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

const parseJwtToken = (token: string): Partial<User> => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      userId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified,
      tenantId: payload['custom:tenant_id'],
      role: payload['custom:role'],
      isAdmin: payload['custom:role'] === 'admin',
      isTenantAdmin: payload['custom:role'] === 'tenant_admin',
      profileCompleted: payload['custom:profile_completed'] === 'true',
      groups: payload['cognito:groups'] || [],
      firstName: payload.given_name,
      lastName: payload.family_name
    };
  } catch (error) {
    console.error('Error parsing JWT token:', error);
    return {};
  }
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();

      if (currentUser && session.tokens?.accessToken && session.tokens?.idToken) {
        const userInfo = parseJwtToken(session.tokens.idToken.toString());
        setUser({
          userId: currentUser.userId,
          email: currentUser.signInDetails?.loginId || '',
          emailVerified: true,
          ...userInfo,
        });
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch {
      console.log('No authenticated user found');
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const { isSignedIn, nextStep } = await amplifySignIn({
        username: email,
        password,
      });

      if (isSignedIn) {
        await checkAuthStatus();
      } else if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        // Handle new password required case
        setError('New password required. Please contact administrator.');
      } else {
        setError('Sign in incomplete. Please try again.');
      }
    } catch (error: unknown) {
      console.error('Sign in error:', error);
      let errorMessage = 'An error occurred during sign in';

      const errorName = getErrorName(error);
      const errorMessageFromError = getErrorMessage(error);

      if (errorName === 'NotAuthorizedException') {
        errorMessage = 'Invalid email or password';
      } else if (errorName === 'UserNotConfirmedException') {
        errorMessage = 'Account not confirmed. Please check your email.';
      } else if (errorName === 'UserNotFoundException') {
        errorMessage = 'User not found';
      } else if (errorMessageFromError) {
        errorMessage = errorMessageFromError;
      }

      setError(errorMessage);
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setIsLoading(true);
      await amplifySignOut();
      setUser(null);
      setIsAuthenticated(false);
      setError(null);
    } catch (error: unknown) {
      console.error('Sign out error:', error);
      setError('Error signing out');
    } finally {
      setIsLoading(false);
    }
  };

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const getToken = async (): Promise<string> => {
    try {
      const session = await fetchAuthSession();
      if (session.tokens?.accessToken) {
        return session.tokens.accessToken.toString();
      }
      throw new Error('No valid token found');
    } catch (error) {
      console.error('Error getting token:', error);
      throw new Error('Failed to get authentication token');
    }
  };

  const refreshUser = async () => {
    try {
      // Force a fresh token fetch by clearing the cached session
      const session = await fetchAuthSession({ forceRefresh: true });

      if (session.tokens?.idToken) {
        const currentUser = await getCurrentUser();
        const userInfo = parseJwtToken(session.tokens.idToken.toString());
        setUser({
          userId: currentUser.userId,
          email: currentUser.signInDetails?.loginId || '',
          emailVerified: true,
          ...userInfo,
        });
        console.log('User refreshed with new token, tenantId:', userInfo.tenantId);
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
      // Fallback to regular checkAuthStatus
      await checkAuthStatus();
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const { isSignUpComplete, nextStep } = await amplifySignUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            given_name: firstName,
            family_name: lastName,
          },
        },
      });

      return { isSignUpComplete, nextStep };
    } catch (error: unknown) {
      console.error('Sign up error:', error);
      let errorMessage = 'An error occurred during sign up';

      const errorName = getErrorName(error);
      const errorMessageFromError = getErrorMessage(error);

      if (errorName === 'UsernameExistsException') {
        errorMessage = 'An account with this email already exists';
      } else if (errorName === 'InvalidPasswordException') {
        errorMessage = 'Password does not meet requirements';
      } else if (errorName === 'InvalidParameterException') {
        errorMessage = 'Invalid email or password format';
      } else if (errorMessageFromError) {
        errorMessage = errorMessageFromError;
      }

      setError(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const confirmSignUp = async (email: string, confirmationCode: string) => {
    try {
      setIsLoading(true);
      setError(null);

      await amplifyConfirmSignUp({
        username: email,
        confirmationCode,
      });

      // After successful confirmation, automatically sign in
      await checkAuthStatus();
    } catch (error: unknown) {
      console.error('Confirm sign up error:', error);
      let errorMessage = 'An error occurred during confirmation';

      const errorName = getErrorName(error);
      const errorMessageFromError = getErrorMessage(error);

      if (errorName === 'CodeMismatchException') {
        errorMessage = 'Invalid confirmation code';
      } else if (errorName === 'ExpiredCodeException') {
        errorMessage = 'Confirmation code has expired';
      } else if (errorName === 'NotAuthorizedException') {
        errorMessage = 'User is already confirmed';
      } else if (errorMessageFromError) {
        errorMessage = errorMessageFromError;
      }

      setError(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const resendSignUpCode = async (email: string) => {
    try {
      setIsLoading(true);
      setError(null);

      await amplifyResendSignUpCode({
        username: email,
      });
    } catch (error: unknown) {
      console.error('Resend code error:', error);
      let errorMessage = 'An error occurred while resending code';

      const errorName = getErrorName(error);
      const errorMessageFromError = getErrorMessage(error);

      if (errorName === 'LimitExceededException') {
        errorMessage = 'Too many requests. Please wait before requesting another code.';
      } else if (errorName === 'InvalidParameterException') {
        errorMessage = 'Invalid email address';
      } else if (errorMessageFromError) {
        errorMessage = errorMessageFromError;
      }

      setError(errorMessage);
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
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.name;
  }
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}
