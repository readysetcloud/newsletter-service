import React from 'react';
import { cn } from '@/utils/cn';

export interface SkipLink {
  id: string;
  href: string;
  text: string;
  onClick?: (e: React.MouseEvent) => void;
}

interface SkipLinksProps {
  links: SkipLink[];
  className?: string;
}

/**
 * Skip links component for keyboard navigation accessibility
 *
 * Skip links allow keyboard users to quickly jump to main content areas,
 * bypassing repetitive navigation elements. They are visually hidden by default
 * but become visible when focused.
 */
export const SkipLinks: React.FC<SkipLinksProps> = ({ links, className }) => {
  if (links.length === 0) return null;

  return (
    <nav
      className={cn('skip-links', className)}
      aria-label="Skip navigation links"
    >
      <ul className="sr-only-focusable">
        {links.map((link) => (
          <li key={link.id}>
            <a
              href={link.href}
              onClick={link.onClick}
              className={cn(
                // Base styles - visually hidden
                'absolute left-[-10000px] top-auto w-1 h-1 overflow-hidden',
                // Focus styles - visible when focused
                'focus:static focus:w-auto focus:h-auto focus:overflow-visible',
                'focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2',
                'focus:rounded focus:shadow-lg focus:z-50',
                'focus:outline-none focus:ring-2 focus:ring-blue-300',
                // Transition for smooth appearance
                'transition-all duration-200',
                // Typography
                'text-sm font-medium',
                // Positioning when visible
                'focus:fixed focus:top-4 focus:left-4'
              )}
            >
              {link.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default SkipLinks;
