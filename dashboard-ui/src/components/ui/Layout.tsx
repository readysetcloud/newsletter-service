import React, { useState } from 'react';
import { cn } from '../../utils/cn';

export interface LayoutProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  className?: string;
}

export interface HeaderProps {
  children: React.ReactNode;
  className?: string;
}

export interface SidebarProps {
  children: React.ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  className?: string;
}

export interface MainContentProps {
  children: React.ReactNode;
  className?: string;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  header,
  sidebar,
  className
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={cn('min-h-screen bg-slate-50', className)}>
      {header && (
        <Header className="sticky top-0 z-40">
          {header}
        </Header>
      )}

      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <Sidebar
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebar}
          </Sidebar>
        )}

        <MainContent className={sidebar ? 'lg:ml-64' : ''}>
          {children}
        </MainContent>
      </div>
    </div>
  );
};

export const Header: React.FC<HeaderProps> = ({ children, className }) => {
  return (
    <header
      className={cn(
        'bg-white border-b border-slate-200 shadow-sm',
        className
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {children}
        </div>
      </div>
    </header>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  children,
  isOpen = false,
  onToggle,
  className
}) => {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={onToggle}
        >
          <div className="fixed inset-0 bg-slate-600 bg-opacity-75" />
        </div>
      )}

      {/* Sidebar */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          className
        )}
      >
        <div className="flex flex-col h-full">
          {/* Mobile close button */}
          <div className="flex items-center justify-end p-4 lg:hidden">
            <button
              onClick={onToggle}
              className="text-slate-400 hover:text-slate-600"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </>
  );
};

export const MainContent: React.FC<MainContentProps> = ({
  children,
  className
}) => {
  return (
    <main className={cn('flex-1 min-w-0 overflow-x-hidden', className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {children}
      </div>
    </main>
  );
};

export const Navigation: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className
}) => {
  return (
    <nav className={cn('space-y-1 px-2 py-4', className)}>
      {children}
    </nav>
  );
};

export interface NavigationItemProps {
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}

export const NavigationItem: React.FC<NavigationItemProps> = ({
  href,
  onClick,
  icon,
  children,
  active = false,
  className
}) => {
  const baseClasses = cn(
    'group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors',
    active
      ? 'bg-blue-100 text-blue-900'
      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
    className
  );

  const content = (
    <>
      {icon && (
        <div className={cn('mr-3 h-5 w-5', active ? 'text-blue-500' : 'text-slate-400 group-hover:text-slate-500')}>
          {icon}
        </div>
      )}
      {children}
    </>
  );

  if (href) {
    return (
      <a href={href} className={baseClasses}>
        {content}
      </a>
    );
  }

  return (
    <button onClick={onClick} className={cn(baseClasses, 'w-full text-left')}>
      {content}
    </button>
  );
};
