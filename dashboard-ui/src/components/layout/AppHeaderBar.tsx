import { Link } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useTheme } from '@/hooks/useTheme';
import { AvatarMenu } from './AvatarMenu';
import { responsiveA11y } from '@/utils/accessibility';
import {
  Bars3Icon,
  ChevronRightIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/24/outline';

export interface AppHeaderBarProps {
  onMobileMenuOpen: () => void;
}

export function AppHeaderBar({ onMobileMenuOpen }: AppHeaderBarProps) {
  const { title, breadcrumb } = usePageMeta();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 bg-surface border-b border-border">
      {/* Skip-to-content link — first focusable element */}
      <a
        href="#main-content"
        className={responsiveA11y.skipLink.className}
      >
        Skip to main content
      </a>

      <div className="flex items-center justify-between h-14 px-4 sm:px-6">
        {/* Left side: hamburger + title/breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Hamburger — visible below md */}
          <button
            type="button"
            onClick={onMobileMenuOpen}
            className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Open navigation menu"
          >
            <Bars3Icon className="h-6 w-6" aria-hidden="true" />
          </button>

          {/* Title or breadcrumb */}
          {breadcrumb ? (
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex items-center gap-1.5 text-sm min-w-0">
                {breadcrumb.map((item, index) => {
                  const isLast = index === breadcrumb.length - 1;
                  return (
                    <li key={item.label} className="flex items-center gap-1.5 min-w-0">
                      {index > 0 && (
                        <ChevronRightIcon
                          className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      {isLast || !item.href ? (
                        <span
                          aria-current="page"
                          className="font-semibold text-foreground truncate"
                        >
                          {item.label}
                        </span>
                      ) : (
                        <Link
                          to={item.href}
                          className="text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring rounded"
                        >
                          {item.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          ) : (
            <h1 className="text-lg font-semibold text-foreground truncate">
              {title}
            </h1>
          )}
        </div>

        {/* Right side: theme toggle + avatar */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? (
              <SunIcon className="h-5 w-5" aria-hidden="true" />
            ) : (
              <MoonIcon className="h-5 w-5" aria-hidden="true" />
            )}
          </button>

          <AvatarMenu />
        </div>
      </div>
    </header>
  );
}
