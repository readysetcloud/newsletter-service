import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscriberProfileModal } from '../SubscriberProfileModal';
import { getEngagementStatus } from '@/utils/engagement';
import type { SubscriberListItem } from '@/types';

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

  it('renders the recent activity timeline straight from the list payload', () => {
    render(
      <SubscriberProfileModal
        subscriber={{
          ...base,
          recentActivity: [
            { type: 'click', issue: 42, ts: recent, url: 'https://example.com/deep/article-path' },
            { type: 'open', issue: 41, ts: recent },
          ],
        }}
        latestIssueNumber={20}
        onClose={() => {}}
      />
    );

    // No fetch/loading state — activity is present immediately.
    expect(screen.queryByText(/Loading activity/)).not.toBeInTheDocument();
    expect(screen.getByText('Opened issue #41')).toBeInTheDocument();
    // Click entries render a shortened URL with the full URL in a title attribute.
    const clickLabel = screen.getByText('example.com/deep/article-path');
    expect(clickLabel).toHaveAttribute('title', 'https://example.com/deep/article-path');
  });

  it('shows an empty activity state when there is no recorded activity', () => {
    render(
      <SubscriberProfileModal
        subscriber={{ ...base, recentActivity: [] }}
        latestIssueNumber={20}
        onClose={() => {}}
      />
    );
    // The rest of the modal (from list data) still renders.
    expect(screen.getByText('Highly Engaged')).toBeInTheDocument();
    expect(screen.getByText(/No recent activity recorded yet/)).toBeInTheDocument();
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
