import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { IssueTimeline } from '../IssueTimeline';
import { findStalledSend, humanizeGap } from '@/utils/issueTimeline';
import type { TimelineEntry } from '@/types/issues';

// Stand-ins for the tenant-zone formatters. `formatLongDate` collapses an
// instant to its day, which is exactly what the component groups on.
const formatLongDate = (value: string) => `day(${value.slice(0, 10)})`;
const formatTime = (value: string) => `time(${value.slice(11, 16)})`;

const entry = (overrides: Partial<TimelineEntry> & { type: string; at: string }): TimelineEntry => ({
  actor: 'system',
  ...overrides
});

const renderTimeline = (entries: TimelineEntry[], timeZoneLabel?: string) =>
  render(
    <IssueTimeline
      entries={entries}
      formatLongDate={formatLongDate}
      formatTime={formatTime}
      timeZoneLabel={timeZoneLabel}
    />
  );

describe('IssueTimeline', () => {
  it('says so when there is nothing recorded', () => {
    renderTimeline([]);

    expect(screen.getByText(/nothing has been recorded/i)).toBeInTheDocument();
  });

  it('renders each event with a human label and a formatted time', () => {
    renderTimeline([
      entry({ type: 'created', at: '2026-08-01T10:00:00.000Z', actor: 'owner@example.com' }),
      entry({ type: 'send_handed_off', at: '2026-08-02T12:00:00.000Z' })
    ]);

    expect(screen.getByText('Draft created')).toBeInTheDocument();
    expect(screen.getByText('Handed to the send path')).toBeInTheDocument();
    expect(screen.getByText('time(10:00)')).toBeInTheDocument();
  });

  // A timeline out of order is worse than no timeline: the whole point is
  // sequence, and somebody reading it will believe what it shows.
  it('orders entries oldest first regardless of the order given', () => {
    renderTimeline([
      entry({ type: 'published', at: '2026-08-02T12:00:01.000Z' }),
      entry({ type: 'created', at: '2026-08-01T10:00:00.000Z' })
    ]);

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Draft created')).toBeInTheDocument();
    expect(within(items[1]).getByText('Marked published')).toBeInTheDocument();
  });

  it('attributes an event to the person who caused it', () => {
    renderTimeline([
      entry({ type: 'resend_requested', at: '2026-08-03T09:00:00.000Z', actor: 'owner@example.com' })
    ]);

    expect(screen.getByText(/owner@example\.com/)).toBeInTheDocument();
  });

  it('does not attribute system events to anybody', () => {
    renderTimeline([entry({ type: 'send_deferred', at: '2026-08-02T12:00:00.000Z' })]);

    expect(screen.queryByText(/· system/)).not.toBeInTheDocument();
  });

  it('marks entries reconstructed from the record', () => {
    renderTimeline([
      entry({ type: 'published', at: '2026-08-02T12:00:00.000Z', derived: true })
    ]);

    expect(screen.getByText(/from record/i)).toBeInTheDocument();
  });

  it('spells out an event detail with a readable label', () => {
    renderTimeline([
      entry({
        type: 'send_deferred',
        at: '2026-08-02T12:00:00.000Z',
        detail: { sendAt: '2026-08-03T14:00:00.000Z', scheduleName: 'email-123-abc' }
      })
    ]);

    expect(screen.getByText('Send time')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('email-123-abc')).toBeInTheDocument();
  });

  // The backend and this build ship separately. An event type it has started
  // recording and this build has not learned about is still evidence, and a
  // hole in the sequence is the one thing this panel must never produce.
  it('renders an event type it does not recognise rather than dropping it', () => {
    renderTimeline([entry({ type: 'quarantined_by_provider', at: '2026-08-02T12:00:00.000Z' })]);

    expect(screen.getByText('Quarantined by provider')).toBeInTheDocument();
    // The event, plus the terminator that closes every timeline.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders a detail key it does not recognise rather than dropping it', () => {
    renderTimeline([
      entry({ type: 'created', at: '2026-08-02T12:00:00.000Z', detail: { somethingNew: 42 } })
    ]);

    expect(screen.getByText('somethingNew')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('states the timezone its times are in, once', () => {
    renderTimeline([entry({ type: 'created', at: '2026-08-01T10:00:00.000Z' })], 'CDT');

    expect(screen.getByText('All times CDT')).toBeInTheDocument();
  });

  describe('as a timeline', () => {
    it('heads each day once, not each event', () => {
      renderTimeline([
        entry({ type: 'created', at: '2026-08-01T10:00:00.000Z' }),
        entry({ type: 'scheduled', at: '2026-08-01T11:00:00.000Z' }),
        entry({ type: 'workflow_started', at: '2026-08-02T12:00:00.000Z' })
      ]);

      expect(screen.getAllByText('day(2026-08-01)')).toHaveLength(1);
      expect(screen.getAllByText('day(2026-08-02)')).toHaveLength(1);
    });

    // The gaps are the story on this system: a workflow runs 26 hours ahead of
    // its send, and a local send reaches its last timezone hours after its
    // first. A reader who cannot see the 26 hours cannot tell that shape apart
    // from a send that hung.
    it('says how long it waited between events', () => {
      renderTimeline([
        entry({ type: 'workflow_started', at: '2026-08-02T12:00:00.000Z' }),
        entry({ type: 'sending_started', at: '2026-08-03T14:00:00.000Z' })
      ]);

      expect(screen.getByText('1d 2h later')).toBeInTheDocument();
    });

    it('does not clutter the rail with gaps too small to mean anything', () => {
      renderTimeline([
        entry({ type: 'workflow_started', at: '2026-08-02T12:00:00.000Z' }),
        entry({ type: 'send_handed_off', at: '2026-08-02T12:00:30.000Z' })
      ]);

      expect(screen.queryByText(/later$/)).not.toBeInTheDocument();
    });

    // The most useful thing this panel can say about a local send with hours of
    // timezones left to reach.
    it('marks an issue whose last event is not terminal as still going', () => {
      renderTimeline([
        entry({
          type: 'fanout_planned',
          at: '2026-08-03T14:00:00.000Z',
          detail: { groups: 14 }
        })
      ]);

      expect(screen.getByText('Still in progress')).toBeInTheDocument();
    });

    it('closes a finished timeline rather than claiming it is still going', () => {
      renderTimeline([
        entry({ type: 'fanout_planned', at: '2026-08-03T14:00:00.000Z' }),
        entry({ type: 'send_completed', at: '2026-08-03T20:30:00.000Z' })
      ]);

      expect(screen.getByText('Nothing further recorded')).toBeInTheDocument();
      expect(screen.queryByText('Still in progress')).not.toBeInTheDocument();
    });

    // `send_completed` is written by the local-send tracker and nothing else, so
    // an ordinary send has no terminal event of its own. Its `sending_started`
    // lands once every SES call has returned, which routinely sorts after the
    // derived `published` — minutes later for a large list, a day later for a
    // deferred one — and the panel used to claim such a send was still running
    // forever.
    it('treats a plain send as finished once its mail has gone', () => {
      renderTimeline([
        entry({ type: 'send_handed_off', at: '2026-08-03T14:00:00.000Z' }),
        entry({ type: 'published', at: '2026-08-03T14:00:01.000Z', derived: true }),
        entry({ type: 'sending_started', at: '2026-08-03T14:06:00.000Z' })
      ]);

      expect(screen.getByText('Nothing further recorded')).toBeInTheDocument();
    });

    // The same event means the opposite thing mid fan-out: one timezone group
    // has gone and a dozen are still queued for hours from now.
    it('keeps a fan-out open when only some groups have sent', () => {
      renderTimeline([
        entry({
          type: 'fanout_planned',
          at: '2026-08-03T14:00:00.000Z',
          detail: { groups: 14 }
        }),
        entry({ type: 'sending_started', at: '2026-08-03T14:01:00.000Z', detail: { group: 'Chicago' } })
      ]);

      expect(screen.getByText('Still in progress')).toBeInTheDocument();
    });
  });
});

describe('humanizeGap', () => {
  it('stays silent below the noise floor', () => {
    expect(humanizeGap(0)).toBeNull();
    expect(humanizeGap(4 * 60 * 1000)).toBeNull();
  });

  it('reads in the largest unit that still carries the detail', () => {
    expect(humanizeGap(6 * 60 * 1000)).toBe('6m later');
    expect(humanizeGap(90 * 60 * 1000)).toBe('1h 30m later');
    expect(humanizeGap(2 * 60 * 60 * 1000)).toBe('2h later');
    // The lead time, which is the gap this exists to make legible.
    expect(humanizeGap(26 * 60 * 60 * 1000)).toBe('1d 2h later');
    expect(humanizeGap(48 * 60 * 60 * 1000)).toBe('2d later');
  });
});

describe('findStalledSend', () => {
  const HANDED_OFF = entry({ type: 'send_handed_off', at: '2026-08-02T12:00:00.000Z' });
  const NOW = new Date('2026-08-04T00:00:00.000Z');

  // The issue 227 shape, and the reason this function exists: status,
  // stats and progress record all look identical to a healthy issue.
  it('flags a hand-off that never produced a send', () => {
    const stalled = findStalledSend(
      [
        entry({ type: 'created', at: '2026-08-01T10:00:00.000Z' }),
        HANDED_OFF,
        entry({
          type: 'send_deferred',
          at: '2026-08-02T12:00:01.000Z',
          detail: { sendAt: '2026-08-03T14:00:00.000Z' }
        }),
        entry({ type: 'published', at: '2026-08-02T12:00:02.000Z', derived: true })
      ],
      NOW
    );

    expect(stalled).toEqual({ deferredUntil: '2026-08-03T14:00:00.000Z' });
  });

  it('stays quiet once mail has actually gone out', () => {
    expect(
      findStalledSend(
        [HANDED_OFF, entry({ type: 'sending_started', at: '2026-08-03T14:00:05.000Z' })],
        NOW
      )
    ).toBeNull();
  });

  // A deferral that has not come due yet is a send waiting, not a send lost.
  // Warning here would fire on every healthy scheduled issue for the whole
  // 26-hour lead window, which would train everyone to ignore the warning.
  it('stays quiet while a deferral is still pending', () => {
    expect(
      findStalledSend(
        [
          HANDED_OFF,
          entry({
            type: 'send_deferred',
            at: '2026-08-02T12:00:01.000Z',
            detail: { sendAt: '2026-08-05T14:00:00.000Z' }
          })
        ],
        NOW
      )
    ).toBeNull();
  });

  it('stays quiet for an issue that was never handed off at all', () => {
    expect(
      findStalledSend([entry({ type: 'created', at: '2026-08-01T10:00:00.000Z' })], NOW)
    ).toBeNull();
  });

  it('flags a hand-off with no deferral and no send', () => {
    expect(findStalledSend([HANDED_OFF], NOW)).toEqual({ deferredUntil: null });
  });

  // A local send records nothing between planning and its first group firing,
  // and reaches the last timezone many hours later. That silence is the normal
  // state of a healthy issue, and warning through it would put the alarm on
  // screen for every local send there is.
  it('stays quiet while a fan-out is still working through its groups', () => {
    expect(
      findStalledSend(
        [
          HANDED_OFF,
          entry({
            type: 'fanout_planned',
            at: '2026-08-02T12:00:01.000Z',
            detail: { groups: 14, catchAllAt: '2026-08-04T20:30:00.000Z' }
          })
        ],
        NOW
      )
    ).toBeNull();
  });

  it('flags a fan-out that is past its own catch-all with nothing sent', () => {
    expect(
      findStalledSend(
        [
          HANDED_OFF,
          entry({
            type: 'fanout_planned',
            at: '2026-08-02T12:00:01.000Z',
            detail: { groups: 14, catchAllAt: '2026-08-03T20:30:00.000Z' }
          })
        ],
        NOW
      )
    ).toEqual({ deferredUntil: null });
  });

  // The send runs in a Lambda invoked after the hand-off is recorded, and it
  // validates the sender and pages the whole subscriber list before mailing
  // anybody. A short silence is expected operation.
  it('stays quiet inside the grace window after a hand-off', () => {
    expect(
      findStalledSend(
        [entry({ type: 'send_handed_off', at: '2026-08-03T23:55:00.000Z' })],
        NOW
      )
    ).toBeNull();
  });

  // Measuring from the first hand-off would call a resend that started seconds
  // ago stale, because the original hand-off is days old.
  it('measures the grace window from the most recent hand-off', () => {
    expect(
      findStalledSend(
        [
          HANDED_OFF,
          entry({ type: 'resend_requested', at: '2026-08-03T23:50:00.000Z' }),
          entry({ type: 'send_handed_off', at: '2026-08-03T23:55:00.000Z' })
        ],
        NOW
      )
    ).toBeNull();
  });

  it('counts a completed fan-out as having sent', () => {
    expect(
      findStalledSend(
        [HANDED_OFF, entry({ type: 'send_completed', at: '2026-08-03T20:00:00.000Z' })],
        NOW
      )
    ).toBeNull();
  });
});
