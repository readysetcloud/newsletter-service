import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from '../NotificationBell';
import { shortAgo, badgeLabel } from '../format';
import { notificationsService } from '@/services/notificationsService';
import type { Notification } from '@/types/notifications';

vi.mock('@/services/notificationsService', () => ({
  notificationsService: {
    listNotifications: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn()
  }
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const mocked = vi.mocked(notificationsService);

const notification = (over: Partial<Notification> = {}): Notification => ({
  id: '1789295400000-report:2026-08:ready',
  type: 'report.ready',
  severity: 'success',
  title: 'Report ready',
  message: 'August 2026 is ready to read.',
  link: '/reports/2026-08',
  createdAt: '2026-09-13T10:30:00.000Z',
  ...over
});

const listOf = (notifications: Notification[], unreadCount = 0, unreadCountCapped = false) => ({
  success: true as const,
  data: { notifications, unreadCount, unreadCountCapped }
});

const renderBell = () =>
  render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  );

const openPanel = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
  return screen.findByRole('dialog', { name: 'Notifications' });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.listNotifications.mockResolvedValue(listOf([]));
  mocked.markRead.mockResolvedValue({ success: true, data: { marked: 1, moreRemaining: false } });
  mocked.markAllRead.mockResolvedValue({ success: true, data: { marked: 3, moreRemaining: false } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the badge', () => {
  it('stays away entirely when nothing is unread', async () => {
    renderBell();

    await waitFor(() => expect(mocked.listNotifications).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('counts unread in its accessible name, not just visually', async () => {
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 3));

    renderBell();

    expect(await screen.findByRole('button', { name: /3 unread/ })).toBeInTheDocument();
  });

  it('says 50+ when the server stopped counting', async () => {
    // The API counts over recent notifications only and flags when it capped.
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 50, true));

    renderBell();

    expect(await screen.findByRole('button', { name: /50\+ unread/ })).toBeInTheDocument();
  });
});

describe('the panel', () => {
  it('stays shut until asked for', async () => {
    renderBell();

    await waitFor(() => expect(mocked.listNotifications).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('re-reads on the way open, so it is never staler than the click', async () => {
    renderBell();
    await waitFor(() => expect(mocked.listNotifications).toHaveBeenCalledTimes(1));

    await openPanel();

    expect(mocked.listNotifications).toHaveBeenCalledTimes(2);
  });

  it('shows what each notification says', async () => {
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 1));

    renderBell();
    await openPanel();

    expect(screen.getByText('Report ready')).toBeInTheDocument();
    expect(screen.getByText('August 2026 is ready to read.')).toBeInTheDocument();
  });

  it('explains itself when there is nothing to show', async () => {
    renderBell();
    await openPanel();

    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });

  it('offers a retry rather than a blank panel when loading failed', async () => {
    mocked.listNotifications.mockResolvedValue({ success: false, error: 'Network down' });

    renderBell();
    await openPanel();

    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderBell();
    await openPanel();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('opening a notification', () => {
  it('navigates to what it is about', async () => {
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 1));

    renderBell();
    await openPanel();
    fireEvent.click(screen.getByText('Report ready'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/reports/2026-08'));
  });

  it('marks it read', async () => {
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 1));

    renderBell();
    await openPanel();
    fireEvent.click(screen.getByText('Report ready'));

    await waitFor(() =>
      expect(mocked.markRead).toHaveBeenCalledWith('1789295400000-report:2026-08:ready')
    );
  });

  it('does not mark an already-read one again', async () => {
    mocked.listNotifications.mockResolvedValue(
      listOf([notification({ readAt: '2026-09-13T11:00:00.000Z' })], 0)
    );

    renderBell();
    await openPanel();
    fireEvent.click(screen.getByText('Report ready'));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(mocked.markRead).not.toHaveBeenCalled();
  });

  it('drops the badge immediately rather than after a round trip', async () => {
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 1));
    // Never resolves: the count must fall without waiting on the server.
    mocked.markRead.mockReturnValue(new Promise(() => {}) as never);

    renderBell();
    await openPanel();
    fireEvent.click(screen.getByText('Report ready'));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    );
  });

  it('still closes the panel for one with nowhere to go', async () => {
    mocked.listNotifications.mockResolvedValue(listOf([notification({ link: undefined })], 1));

    renderBell();
    await openPanel();
    fireEvent.click(screen.getByText('Report ready'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('mark all read', () => {
  it('is offered only when something is unread', async () => {
    mocked.listNotifications.mockResolvedValue(
      listOf([notification({ readAt: '2026-09-13T11:00:00.000Z' })], 0)
    );

    renderBell();
    await openPanel();

    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument();
  });

  it('clears the badge', async () => {
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 1));

    renderBell();
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));

    await waitFor(() => expect(mocked.markAllRead).toHaveBeenCalled());
  });

  it('re-reads when the server says it could not mark them all', async () => {
    // Mark-all is bounded server-side, so claiming zero unread would be a lie
    // for an inbox deeper than that bound.
    mocked.listNotifications.mockResolvedValue(listOf([notification()], 1));
    mocked.markAllRead.mockResolvedValue({
      success: true,
      data: { marked: 200, moreRemaining: true }
    });

    renderBell();
    await openPanel();
    const before = mocked.listNotifications.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));

    await waitFor(() =>
      expect(mocked.listNotifications.mock.calls.length).toBeGreaterThan(before)
    );
  });
});

describe('polling', () => {
  it('does not poll while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    renderBell();
    await vi.waitFor(() => expect(mocked.listNotifications).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(70_000);

    // Only the initial read on mount; the interval fired and declined.
    expect(mocked.listNotifications).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});

describe('shortAgo', () => {
  const now = new Date('2026-09-13T12:00:00.000Z').getTime();

  it.each([
    ['2026-09-13T11:59:30.000Z', 'just now'],
    ['2026-09-13T11:56:00.000Z', '4m'],
    ['2026-09-13T09:00:00.000Z', '3h'],
    ['2026-09-11T12:00:00.000Z', '2d']
  ])('renders %s as %s', (iso, expected) => {
    expect(shortAgo(iso, now)).toBe(expected);
  });

  it('gives a date once "days ago" stops being readable', () => {
    // "63d" is not a time anyone parses.
    expect(shortAgo('2026-07-12T12:00:00.000Z', now)).toMatch(/Jul/);
  });

  it('returns nothing for a timestamp it cannot read', () => {
    expect(shortAgo('not a date', now)).toBe('');
  });

  it('does not render a future timestamp as negative', () => {
    expect(shortAgo('2026-09-13T12:05:00.000Z', now)).toBe('just now');
  });
});

describe('badgeLabel', () => {
  it('shows the count when it is the whole count', () => {
    expect(badgeLabel(7, false)).toBe('7');
  });

  it('marks a capped count so it does not read as exact', () => {
    expect(badgeLabel(50, true)).toBe('50+');
  });
});
