import { AppNavBar } from './AppNavBar';
import { PageHeaderBar } from './PageHeaderBar';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    // Column on mobile (AppNav collapses to a top-bar drawer); row on ≥sm,
    // where AppNav renders a fixed-width vertical rail beside the content.
    <div className="min-h-screen bg-background flex flex-col sm:flex-row">
      {/* Shared navigation rail (brand, grouped nav, theme, account menu) */}
      <AppNavBar />

      {/* Content column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Per-page title / breadcrumb */}
        <PageHeaderBar />

        <main id="main-content" className="flex-1 bg-surface">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
