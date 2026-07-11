import { AppNavBar } from './AppNavBar';
import { PageHeaderBar } from './PageHeaderBar';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Shared top navigation (brand, primary nav, theme, account menu) */}
      <AppNavBar />

      {/* Per-page title / breadcrumb */}
      <PageHeaderBar />

      <main id="main-content" className="bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
