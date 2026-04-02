import { Link, useLocation } from 'react-router-dom';
import { responsiveA11y } from '@/utils/accessibility';
import { preloadRoute } from '@/utils/lazyImports';
import { cn } from '@/utils/cn';
import { NAV_ITEMS, isNavItemActive } from './sidebarNav';

export function AppSidebar() {
  const location = useLocation();

  return (
    <aside className="flex flex-col w-64 bg-surface border-r border-border">
      {/* Logo + Brand */}
      <div className="flex items-center gap-3 px-4 py-5">
        <img
          src="/logo.svg"
          alt="Outboxed"
          className="h-8 w-8 shrink-0"
        />
        <span className="text-xl font-bold text-foreground">Outboxed</span>
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" className="flex-1 px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(item, location.pathname);

            return (
              <li key={item.href}>
                <Link
                  to={item.href}
                  onMouseEnter={() => preloadRoute(item.preloadKey)}
                  onFocus={() => preloadRoute(item.preloadKey)}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    responsiveA11y.focusRing.className,
                    active
                      ? 'bg-primary-100 text-primary-700 border-l-4 border-primary-700'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
