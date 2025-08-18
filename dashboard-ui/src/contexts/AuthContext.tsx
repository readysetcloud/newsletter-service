import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ isSignUpComplete: boolean; nextStep?: any }>;
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

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Parse JWT token to extract user information
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

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
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
    } catch (error) {
      console.log('No authenticated user found');
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

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
    } catch (error: any) {
      console.error('Sign in error:', error);
      let errorMessage = 'An error occurred during sign in';

      if (error.name === 'NotAuthorizedException') {
        errorMessage = 'Invalid email or password';
      } else if (error.name === 'UserNotConfirmedException') {
        errorMessage = 'Account not confirmed. Please check your email.';
      } else if (error.name === 'UserNotFoundException') {
        errorMessage = 'User not found';
      } else if (error.message) {
        errorMessage = error.message;
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
    } catch (error: any) {
      console.error('Sign out error:', error);
      setError('Error signing out');
    } finally {
      setIsLoading(false);
    }
  };

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
    } catch (error: any) {
      console.error('Sign up error:', error);
      let errorMessage = 'An error occurred during sign up';

      if (error.name === 'UsernameExistsException') {
        errorMessage = 'An account with this email already exists';
      } else if (error.name === 'InvalidPasswordException') {
        errorMessage = 'Password does not meet requirements';
      } else if (error.name === 'InvalidParameterException') {
        errorMessage = 'Invalid email or password format';
      } else if (error.message) {
        errorMessage = error.message;
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
    } catch (error: any) {
      console.error('Confirm sign up error:', error);
      let errorMessage = 'An error occurred during confirmation';

      if (error.name === 'CodeMismatchException') {
        errorMessage = 'Invalid confirmation code';
      } else if (error.name === 'ExpiredCodeException') {
        errorMessage = 'Confirmation code has expired';
      } else if (error.name === 'NotAuthorizedException') {
        errorMessage = 'User is already confirmed';
      } else if (error.message) {
        errorMessage = error.message;
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
    } catch (error: any) {
      console.error('Resend code error:', error);
      let errorMessage = 'An error occurred while resending code';

      if (error.name === 'LimitExceededException') {
        errorMessage = 'Too many requests. Please wait before requesting another code.';
      } else if (error.name === 'InvalidParameterException') {
        errorMessage = 'Invalid email address';
      } else if (error.message) {
        errorMessage = error.message;
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
