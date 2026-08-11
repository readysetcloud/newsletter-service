
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { BRAND } from '@/constants/brand';

interface LoginRedirectState {
  from?: { pathname?: string };
}

export function LoginPage() {
  const { isAuthenticated, isLoading, sessionExpired } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <svg className="animate-spin h-8 w-8 text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  // Send an authenticated visitor back where they were headed. ProtectedRoute
  // records that in `state.from`; `/` is the dashboard. (This used to point at
  // `/dashboard`, which is not a route — it only worked by falling through the
  // catch-all, and it threw away the route the user actually asked for.)
  if (isAuthenticated) {
    const from = (location.state as LoginRedirectState | null)?.from?.pathname;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <img
            src={BRAND.assets.logoFull}
            alt={BRAND.appName}
            className="mx-auto h-10 sm:h-12"
          />
          <p className="text-muted-foreground">
            Manage your newsletter brands and settings
          </p>
        </div>
      </div>

      {sessionExpired && (
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div
            role="status"
            className="bg-warning-50 border border-warning-200 rounded-md p-3 text-sm text-warning-600"
          >
            Your session expired. Please sign in again.
          </div>
        </div>
      )}

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <LoginForm onSuccess={() => {
          // Navigation will be handled by the redirect logic above
        }} />
      </div>

      <div className="mt-8 text-center">
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link
            to="/signup"
            className="text-primary-600 hover:text-primary-700 font-medium"
          >
            Sign up
          </Link>
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Need help? Contact your administrator
        </p>
      </div>
    </div>
  );
}
