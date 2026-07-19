import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SubscriberProfileModal } from '../SubscriberProfileModal';
import { getEngagementStatus } from '@/utils/engagement';
import { subscriberService } from '@/services/subscriberService';
import type { SubscriberListItem, SubscriberDetail } from '@/types';

// Render the modal shell as plain markup so the native <dialog> (showModal) is
// not required in jsdom; we only care about the content the modal renders.
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
  ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  ModalDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/services/subscriberService', () => ({
  subscriberService: {
    getSubscriber: vi.fn(),
  },
}));

const mockGetSubscriber = vi.mocked(subscriberService.getSubscriber);

const recent = new Date().toISOString();

describe('getEngagementStatus', () => {
  it('classifies recent engagement as Highly Engaged', () => {
    expect(getEngagementStatus(20, 20).text).toBe('Highly Engaged');
    expect(getEngagementStatus(19, 20).text).toBe('Highly Engaged');
  });

  it('classifies mid-range engagement as Occasional', () => {
    expect(getEngagementStatus(18, 20).text).toBe('Occasional');
    expect(getEngagementStatus(11, 20).text).toBe('Occasional');
  });

  it('classifies old or missing engagement as Dormant', () => {
    expect(getEngagementStatus(10, 20).text).toBe('Dormant');
    expect(getEngagementStatus(null, 20).text).toBe('Dormant');
  });

  it('returns Unknown when there is no latest issue', () => {
    expect(getEngagementStatus(5, 0).text).toBe('Unknown');
  });
});

describe('SubscriberProfileModal', () => {
  const base: SubscriberListItem = {
    email: 'reader@example.com',
    addedAt: '2025-01-01T00:00:00Z',
    firstName: 'Ada',
    lastName: 'Lovelace',
    lastEngagedIssue: 19,
    engagementCount: 7,
    interestScores: {
      ai: { score: 4, lastScoredAt: recent },
      devops: { score: 1, lastScoredAt: recent },
    },
    suspectedBot: false,
  };

  beforeEach(() => {
    // Default: detail fetch yields nothing so activity falls back to empty state.
    mockGetSubscriber.mockReset();
    mockGetSubscriber.mockResolvedValue({ success: false, error: 'nope' });
  });

  it('renders nothing when no subscriber is selected', () => {
    const { container } = render(
      <SubscriberProfileModal subscriber={null} latestIssueNumber={20} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the subscriber name, engagement depth and interest topics', () => {
    render(
      <SubscriberProfileModal subscriber={base} latestIssueNumber={20} onClose={() => {}} />
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
    expect(screen.getByText('Highly Engaged')).toBeInTheDocument();
    expect(screen.getByText('7 issues engaged')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('DevOps')).toBeInTheDocument();
  });

  it('calls out topics that reached the auto-segment threshold', () => {
    render(
      <SubscriberProfileModal subscriber={base} latestIssueNumber={20} onClose={() => {}} />
    );
    // ai has score 4 (>= 3) so it should be named in the auto-segment note
    expect(screen.getByText(/Auto-segmented into/)).toBeInTheDocument();
  });

  it('shows the detected timezone when confirmed', () => {
    render(
      <SubscriberProfileModal
        subscriber={{ ...base, timeZone: 'America/Chicago' }}
        latestIssueNumber={20}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/Local timezone: America\/Chicago/)).toBeInTheDocument();
  });

  it('omits the timezone row when not confirmed', () => {
    render(
      <SubscriberProfileModal subscriber={base} latestIssueNumber={20} onClose={() => {}} />
    );
    expect(screen.queryByText(/Local timezone:/)).not.toBeInTheDocument();
  });

  it('shows an empty-state message when there is no interest signal', () => {
    render(
      <SubscriberProfileModal
        subscriber={{ ...base, interestScores: null }}
        latestIssueNumber={20}
        onClose={() => {}}
      />
    );
    expect(
      screen.getByText(/No interest signal yet/)
    ).toBeInTheDocument();
  });

  it('fetches and renders the recent activity timeline when the modal opens', async () => {
    const detail: SubscriberDetail = {
      email: 'reader@example.com',
      addedAt: '2025-01-01T00:00:00Z',
      lastEngagedIssue: 19,
      recentActivity: [
        { type: 'click', issue: 42, ts: recent, url: 'https://example.com/deep/article-path' },
        { type: 'open', issue: 41, ts: recent },
      ],
      openHourTotal: 5,
    };
    mockGetSubscriber.mockResolvedValue({ success: true, data: detail });

    render(
      <SubscriberProfileModal subscriber={base} latestIssueNumber={20} onClose={() => {}} />
    );

    expect(mockGetSubscriber).toHaveBeenCalledWith('reader@example.com');
    expect(await screen.findByText('Opened issue #41')).toBeInTheDocument();
    // Click entries render a shortened URL with the full URL in a title attribute.
    const clickLabel = screen.getByText('example.com/deep/article-path');
    expect(clickLabel).toHaveAttribute('title', 'https://example.com/deep/article-path');
  });

  it('shows a loading state while the activity fetch is in flight', () => {
    mockGetSubscriber.mockReturnValue(new Promise(() => {}));
    render(
      <SubscriberProfileModal subscriber={base} latestIssueNumber={20} onClose={() => {}} />
    );
    expect(screen.getByText(/Loading activity/)).toBeInTheDocument();
  });

  it('falls back to an empty activity state when the detail fetch fails', async () => {
    mockGetSubscriber.mockRejectedValue(new Error('boom'));
    render(
      <SubscriberProfileModal subscriber={base} latestIssueNumber={20} onClose={() => {}} />
    );
    // The rest of the modal (from list data) still renders.
    expect(screen.getByText('Highly Engaged')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/No recent activity recorded yet/)).toBeInTheDocument()
    );
  });

  it('shows a neutral label instead of the raw email when no name was given', () => {
    render(
      <SubscriberProfileModal
        subscriber={{ ...base, firstName: undefined, lastName: undefined }}
        latestIssueNumber={20}
        onClose={() => {}}
      />
    );
    // Title falls back to a neutral label rather than surfacing the raw email
    // as if it were the subscriber's name.
    expect(screen.getByRole('heading', { name: 'Unnamed subscriber' })).toBeInTheDocument();
    // The email is still shown (as the secondary description line).
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
  });
});
