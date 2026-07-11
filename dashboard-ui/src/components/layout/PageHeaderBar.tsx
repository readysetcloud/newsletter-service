import { Link } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

/**
 * Page title / breadcrumb bar shown directly beneath {@link AppNavBar}.
 *
 * The shared `AppNav` has no slot for a per-page title, so this preserves the
 * heading + breadcrumb that the old `AppHeaderBar` used to render (its
 * hamburger, theme toggle, and avatar all moved into `AppNav`).
 */
export function PageHeaderBar() {
  const { title, breadcrumb } = usePageMeta();

  return (
    <div className="border-b border-border bg-surface">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center">
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
          <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>
        )}
      </div>
    </div>
  );
}
