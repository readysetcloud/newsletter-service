import React from 'react';

interface MainContentProps {
  children: React.ReactNode;
  className?: string;
  pageTitle?: string;
}

export const MainContent: React.FC<MainContentProps> = ({
  children,
  className = '',
  pageTitle
}) => {
  return (
    <main
      id="main-content"
      className={`flex-1 ${className}`}
      role="main"
      aria-label={pageTitle ? `${pageTitle} page content` : 'Main content'}
    >
      {children}
    </main>
  );
};
