import { useState, useCallback } from 'react';
import { AppSidebar } from './AppSidebar';
import { AppHeaderBar } from './AppHeaderBar';
import { MobileDrawer } from './MobileDrawer';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const handleMobileMenuOpen = useCallback(() => {
    setMobileDrawerOpen(true);
  }, []);

  const handleMobileDrawerClose = useCallback(() => {
    setMobileDrawerOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar — fixed, hidden below md */}
      <div className="fixed inset-y-0 left-0 w-64 hidden md:flex">
        <AppSidebar />
      </div>

      {/* Mobile drawer */}
      <MobileDrawer isOpen={mobileDrawerOpen} onClose={handleMobileDrawerClose} />

      {/* Main area offset by sidebar width on md+ */}
      <div className="md:ml-64">
        <AppHeaderBar onMobileMenuOpen={handleMobileMenuOpen} />

        <main id="main-content" className="bg-surface">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
