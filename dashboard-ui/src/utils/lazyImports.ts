import { lazy } from 'react';

// Lazy load page components with error handling
export const LazyLoginPage = lazy(() =>
  import('@/pages/auth/LoginPage').then(module => ({ default: module.LoginPage }))
    .catch(error => {
      console.error('Failed to load LoginPage:', error);
      throw error;
    })
);

export const LazySignUpPage = lazy(() =>
  import('@/pages/auth/SignUpPage').then(module => ({ default: module.SignUpPage }))
    .catch(error => {
      console.error('Failed to load SignUpPage:', error);
      throw error;
    })
);

export const LazyDashboardPage = lazy(() =>
  import('@/pages/dashboard/DashboardPage').then(module => ({ default: module.DashboardPage }))
    .catch(error => {
      console.error('Failed to load DashboardPage:', error);
      throw error;
    })
);

export const LazyBrandPage = lazy(() =>
  import('@/pages/brand/BrandPage').then(module => ({ default: module.BrandPage }))
    .catch(error => {
      console.error('Failed to load BrandPage:', error);
      throw error;
    })
);

export const LazyProfilePage = lazy(() =>
  import('@/pages/profile/ProfilePage').then(module => ({ default: module.ProfilePage }))
    .catch(error => {
      console.error('Failed to load ProfilePage:', error);
      throw error;
    })
);

export const LazyApiKeysPage = lazy(() =>
  import('@/pages/api-keys').then(module => ({ default: module.ApiKeysPage }))
    .catch(error => {
      console.error('Failed to load ApiKeysPage:', error);
      throw error;
    })
);

// Preload critical routes
export const preloadCriticalRoutes = () => {
  // Preload dashboard since it's the default route
  import('@/pages/dashboard/DashboardPage');

  // Preload login page for unauthenticated users
  import('@/pages/auth/LoginPage');

  // Preload signup page for new users
  import('@/pages/auth/SignUpPage');

  // Preload onboarding for new users
  import('@/pages/onboarding/BrandOnboardingPage');
};

// Preload route on hover/focus for better UX
export const preloadRoute = (routeName: string) => {
  switch (routeName) {
    case 'dashboard':
      import('@/pages/dashboard/DashboardPage');
      break;
    case 'brand':
      import('@/pages/brand/BrandPage');
      break;
    case 'profile':
      import('@/pages/profile/ProfilePage');
      break;
    case 'api-keys':
      import('@/pages/api-keys');
      break;
    case 'login':
      import('@/pages/auth/LoginPage');
      break;
    case 'signup':
      import('@/pages/auth/SignUpPage');
      break;
    default:
      console.warn(`Unknown route for preloading: ${routeName}`);
  }
};
