import { useLocation, useParams } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageMeta {
  title: string;
  breadcrumb: BreadcrumbItem[] | null;
}

export const ROUTE_META: Record<string, { title: string; parent?: { label: string; href: string } }> = {
  '/': { title: 'Dashboard' },
  '/issues': { title: 'Issues' },
  '/subscribers': { title: 'Subscribers' },
  '/brand': { title: 'Brand' },
  '/pricing': { title: 'Sponsors' },
  '/profile': { title: 'Profile' },
  '/senders': { title: 'Sender Emails' },
  '/api-keys': { title: 'API Keys' },
  '/billing': { title: 'Billing' },
};

export function usePageMeta(dynamicTitle?: string): PageMeta {
  const { pathname } = useLocation();
  const params = useParams<{ id?: string; segmentId?: string }>();

  // Check static routes first
  const staticMeta = ROUTE_META[pathname];
  if (staticMeta) {
    return {
      title: staticMeta.title,
      breadcrumb: null,
    };
  }

  // Dynamic route: /issues/new
  if (pathname === '/issues/new') {
    return {
      title: 'New Issue',
      breadcrumb: [
        { label: 'Issues', href: '/issues' },
        { label: 'New Issue' },
      ],
    };
  }

  // Dynamic route: /issues/:id/edit
  if (params.id && pathname === `/issues/${params.id}/edit`) {
    const title = `Edit Issue #${params.id}`;
    return {
      title,
      breadcrumb: [
        { label: 'Issues', href: '/issues' },
        { label: title },
      ],
    };
  }

  // Dynamic route: /issues/:id
  if (params.id && pathname === `/issues/${params.id}`) {
    const title = `Issue #${params.id}`;
    return {
      title,
      breadcrumb: [
        { label: 'Issues', href: '/issues' },
        { label: title },
      ],
    };
  }

  // Dynamic route: /segments/:segmentId
  if (params.segmentId && pathname === `/segments/${params.segmentId}`) {
    const label = dynamicTitle || 'Segment';
    return {
      title: label,
      breadcrumb: [
        { label: 'Subscribers', href: '/subscribers' },
        { label },
      ],
    };
  }

  // Fallback for unknown routes
  return {
    title: 'Dashboard',
    breadcrumb: null,
  };
}
