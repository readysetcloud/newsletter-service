import React from 'react';
import { usePerformanceMetric } from '../../utils/performance';

interface MainContentProps {
  children: React.ReactNode;
  className?: string;
  pageTitle?: string;
  id?: string;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
}

export const MainContent: React.FC<MainContentProps> = ({
  children,
  className = '',
  pageTitle,
  id = 'main-content',
  role = 'main',
  tabIndex,
  'aria-label': ariaLabel
}) => {
  // Track page render performance
  usePerformanceMetric(pageTitle || 'page');

  return (
    <main
      id={id}
      className={`flex-1 ${className}`}
      role={role}
      aria-label={ariaLabel || (pageTitle ? `${pageTitle} page content` : 'Main content')}
      tabIndex={tabIndex}
    >
      {children}
    </main>
  );
};
