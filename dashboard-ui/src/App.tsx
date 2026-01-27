import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { OnboardingGuard } from '@/components/auth/OnboardingGuard';
import { ErrorBoundary, RouteErrorBoundary } from '@/components/error';
import { PageLoader } from '@/components/ui/LazyLoader';
import { VerifySenderPage } from '@/pages/verify-sender/VerifySenderPage';
import {
  LazyLoginPage,
  LazySignUpPage,
  LazyDashboardPage,
  LazyBrandPage,
  LazyProfilePage,
  LazyApiKeysPage,
  LazySenderEmailSetupPage,
  LazyBillingPage,
  preloadCriticalRoutes
} from '@/utils/lazyImports';
import { BrandOnboardingPage, ProfileOnboardingPage, SenderOnboardingPage } from '@/pages/onboarding';
import { useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';

function App() {
  useTheme();

  useEffect(() => {
    // Preload critical routes after initial render
    preloadCriticalRoutes();
  }, []);

  return (
    <ErrorBoundary>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <AuthProvider>
          <ToastProvider>
            <div className="min-h-screen bg-background overflow-x-hidden flex flex-col">
              <div className="flex-1">
                <Routes>
                  {/* Public Routes */}
                  <Route
                    path="/login"
                    element={
                      <RouteErrorBoundary routeName="Login">
                        <PageLoader>
                          <LazyLoginPage />
                        </PageLoader>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/signup"
                    element={
                      <RouteErrorBoundary routeName="Sign Up">
                        <PageLoader>
                          <LazySignUpPage />
                        </PageLoader>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/verify-sender"
                    element={
                      <RouteErrorBoundary routeName="Verify Sender">
                        <PageLoader>
                          <VerifySenderPage />
                        </PageLoader>
                      </RouteErrorBoundary>
                    }
                  />

                  {/* Onboarding Routes */}
                  <Route
                    path="/onboarding/brand"
                    element={
                      <RouteErrorBoundary routeName="Brand Onboarding">
                        <ProtectedRoute>
                          <BrandOnboardingPage />
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/onboarding/profile"
                    element={
                      <RouteErrorBoundary routeName="Profile Onboarding">
                        <ProtectedRoute>
                          <ProfileOnboardingPage />
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/onboarding/sender"
                    element={
                      <RouteErrorBoundary routeName="Sender Onboarding">
                        <ProtectedRoute>
                          <SenderOnboardingPage />
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />

                  {/* Protected Routes with Onboarding Guard */}
                  <Route
                    path="/dashboard"
                    element={
                      <RouteErrorBoundary routeName="Dashboard">
                        <ProtectedRoute>
                          <OnboardingGuard>
                            <PageLoader>
                              <LazyDashboardPage />
                            </PageLoader>
                          </OnboardingGuard>
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/brand"
                    element={
                      <RouteErrorBoundary routeName="Brand">
                        <ProtectedRoute>
                          <OnboardingGuard allowOnboarding>
                            <PageLoader>
                              <LazyBrandPage />
                            </PageLoader>
                          </OnboardingGuard>
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <RouteErrorBoundary routeName="Profile">
                        <ProtectedRoute>
                          <OnboardingGuard allowOnboarding>
                            <PageLoader>
                              <LazyProfilePage />
                            </PageLoader>
                          </OnboardingGuard>
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/api-keys"
                    element={
                      <RouteErrorBoundary routeName="API Keys">
                        <ProtectedRoute>
                          <OnboardingGuard>
                            <PageLoader>
                              <LazyApiKeysPage />
                            </PageLoader>
                          </OnboardingGuard>
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/senders"
                    element={
                      <RouteErrorBoundary routeName="Sender Email Setup">
                        <ProtectedRoute>
                          <OnboardingGuard>
                            <PageLoader>
                              <LazySenderEmailSetupPage />
                            </PageLoader>
                          </OnboardingGuard>
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route
                    path="/billing"
                    element={
                      <RouteErrorBoundary routeName="Billing">
                        <ProtectedRoute>
                          <OnboardingGuard>
                            <PageLoader>
                              <LazyBillingPage />
                            </PageLoader>
                          </OnboardingGuard>
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />

                  {/* Default redirect */}
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />

                  {/* Catch all - redirect to dashboard */}
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </div>
              <footer className="border-t border-border bg-surface">
                <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-muted-foreground sm:px-6 lg:px-8">
                  © {new Date().getFullYear()} Outboxed
                </div>
              </footer>
            </div>
          </ToastProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
