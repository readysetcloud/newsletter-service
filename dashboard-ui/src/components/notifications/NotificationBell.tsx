import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BarChart3,
  CalendarOff,
  AlertCircle,
  Send,
  MailCheck,
  MailWarning,
  CreditCard,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { notificationsService } from '@/services/notificationsService';
import { shortAgo, badgeLabel } from './format';
import type { Notification, NotificationType } from '@/types/notifications';
import type { ApiResponse } from '@/types';
import type { ListNotificationsResponse } from '@/types/notifications';

/**
 * How often the badge re-reads while the page is open.
 *
 * There is no push, so the count is only ever as fresh as the last read. A
 * minute is often enough that a report finishing feels prompt, and rare enough
 * that a dashboard left open all day costs a handful of requests. The poll
 * stops entirely while the tab is hidden.
 */
const POLL_INTERVAL_MS = 60_000;

/** How many to show in the panel. Enough to scroll, not enough to hang. */
const PAGE_SIZE = 20;

/** The icon for each kind of notification, so wording never decides the look. */
const ICONS: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  'report.ready': BarChart3,
  'report.empty': CalendarOff,
  'report.failed': AlertCircle,
  'issue.published': Send,
  'issue.failed': AlertCircle,
  'sender.verified': MailCheck,
  'sender.failed': MailWarning,
  'billing.payment_succeeded': CreditCard,
  'billing.payment_failed': CreditCard,
};

const SEVERITY_COLOR: Record<string, string> = {
  info: 'text-muted-foreground',
  success: 'text-success-600 dark:text-success-400',
  warning: 'text-warning-600 dark:text-warning-400',
  error: 'text-error-600 dark:text-error-400',
};

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadCapped, setUnreadCapped] = useState(false);
  // True from the start: this always reads on mount, and a bell that has not
  // loaded yet is loading.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((response: ApiResponse<ListNotificationsResponse>) => {
    if (response.success && response.data) {
      setNotifications(response.data.notifications);
      setUnreadCount(response.data.unreadCount);
      setUnreadCapped(response.data.unreadCountCapped);
      setError(null);
    } else {
      // Quietly: a bell that cannot load is not worth a toast over whatever
      // someone is actually doing. The panel says so when they open it.
      setError(response.error || 'Could not load notifications');
    }

    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    apply(await notificationsService.listNotifications({ limit: PAGE_SIZE }));
  }, [apply]);

  // The first read, deliberately not routed through `load`.
  //
  // `load` sets the loading flag as its first act, and doing that synchronously
  // inside an effect invalidates the render that just happened. Starting the
  // request and applying the result when it lands keeps every state change on
  // the far side of an await — and gives somewhere to drop the result if this
  // unmounts first.
  useEffect(() => {
    let cancelled = false;

    void notificationsService
      .listNotifications({ limit: PAGE_SIZE })
      .then((response) => {
        if (!cancelled) apply(response);
      });

    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Poll only while the tab is actually being looked at. A backgrounded
  // dashboard should cost nothing.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };

    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  // Close on a click anywhere else, or on Escape.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      // Re-read on the way open, so the panel is never staler than the click.
      if (!wasOpen) void load();
      return !wasOpen;
    });
  }, [load]);

  const openNotification = useCallback(
    async (notification: Notification) => {
      setOpen(false);

      if (!notification.readAt) {
        // Locally first: the row should stop looking unread the moment it is
        // clicked, not a round trip later.
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id
              ? { ...item, readAt: new Date().toISOString() }
              : item
          )
        );
        setUnreadCount((current) => Math.max(0, current - 1));

        void notificationsService.markRead(notification.id);
      }

      if (notification.link) navigate(notification.link);
    },
    [navigate]
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt: now }))
    );
    setUnreadCount(0);
    setUnreadCapped(false);

    const response = await notificationsService.markAllRead();

    // The server bounds how many one call touches, so an inbox deeper than
    // that still has unread ones behind these. Re-read rather than claim zero.
    if (response.success && response.data?.moreRemaining) {
      void load();
    }
  }, [load]);

  const hasUnread = unreadCount > 0;
  const label = useMemo(
    () => (hasUnread
      ? `Notifications, ${badgeLabel(unreadCount, unreadCapped)} unread`
      : 'Notifications'),
    [hasUnread, unreadCount, unreadCapped]
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Bell className="w-5 h-5" aria-hidden="true" />
        {hasUnread && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center rounded-full bg-error-600 text-white text-[10px] font-semibold leading-none"
          >
            {badgeLabel(unreadCount, unreadCapped)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[28rem] flex flex-col bg-surface border border-border rounded-lg shadow-lg z-50"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
            {hasUnread && (
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                Mark all read
              </Button>
            )}
          </div>

          <div className="overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Loading
              </div>
            ) : error ? (
              <div className="px-4 py-8 text-center" role="alert">
                <p className="text-sm text-muted-foreground mb-3">{error}</p>
                <Button variant="outline" size="sm" onClick={load}>
                  Try again
                </Button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto w-8 h-8 text-muted-foreground mb-3" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Nothing yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Reports, sends, and billing updates will show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((notification) => {
                  const Icon = ICONS[notification.type] ?? Bell;
                  const unread = !notification.readAt;

                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(notification)}
                        className={`w-full text-left flex gap-3 px-4 py-3 transition-colors hover:bg-muted focus:outline-none focus-visible:bg-muted ${
                          unread ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 mt-0.5 shrink-0 ${SEVERITY_COLOR[notification.severity] ?? SEVERITY_COLOR.info}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span
                              className={`text-sm truncate ${unread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'}`}
                            >
                              {notification.title}
                            </span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {shortAgo(notification.createdAt)}
                            </span>
                          </span>
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            {notification.message}
                          </span>
                        </span>
                        {unread && (
                          <span
                            className="w-2 h-2 mt-1.5 rounded-full bg-primary-600 shrink-0"
                            aria-label="Unread"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
