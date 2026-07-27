import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SendProgressCard } from '../SendProgressCard';
import type { SendProgress, SendProgressGroup, WorkflowState } from '@/types/issues';

const group = (overrides: Partial<SendProgressGroup> = {}): SendProgressGroup => ({
  label: 'America/Chicago',
  name: 'Chicago',
  sendAt: '2026-07-27T14:00:00.000Z',
  status: 'sent',
  size: 40,
  recipients: 38,
  sentAt: '2026-07-27T14:00:30.000Z',
  overdue: false,
  ...overrides,
});

const progress = (overrides: Partial<SendProgress> = {}): SendProgress => ({
  state: 'sending',
  message: 'Sending — 1 of 3 groups delivered, 38 subscribers so far.',
  mode: 'timezone',
  defaultTimeZone: 'America/Chicago',
  groupsTotal: 3,
  groupsDelivered: 1,
  recipientsSent: 38,
  totalSubscribers: 152,
  startedAt: '2026-07-27T14:00:02.000Z',
  expectedCompleteAt: '2026-07-27T20:30:00.000Z',
  nextSendAt: '2026-07-27T16:00:00.000Z',
  groups: [
    group(),
    group({
      label: 'America/Los_Angeles',
      name: 'Los Angeles',
      sendAt: '2026-07-27T16:00:00.000Z',
      status: 'pending',
      size: 12,
      recipients: undefined,
      sentAt: undefined,
    }),
    group({
      label: '__catch_all__',
      name: 'Final sweep',
      sendAt: '2026-07-27T20:30:00.000Z',
      status: 'pending',
      size: undefined,
      recipients: undefined,
      sentAt: undefined,
    }),
  ],
  ...overrides,
});

describe('SendProgressCard', () => {
  it('renders nothing when the issue has neither progress nor workflow state', () => {
    const { container } = render(<SendProgressCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the summary, counts and every group', () => {
    render(<SendProgressCard sendProgress={progress()} />);

    expect(screen.getByText(/1 of 3 groups delivered/)).toBeInTheDocument();
    expect(screen.getByText('Sending')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Chicago')).toBeInTheDocument();
    expect(screen.getByText('Los Angeles')).toBeInTheDocument();
    expect(screen.getByText('Final sweep')).toBeInTheDocument();
    expect(screen.getByText('38 sent')).toBeInTheDocument();
  });

  it('reports progress against the planned group count for assistive tech', () => {
    render(<SendProgressCard sendProgress={progress()} />);

    const bar = screen.getByRole('progressbar', { name: /groups delivered/i });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
  });

  it('labels a finished send as delivered rather than still sending', () => {
    render(
      <SendProgressCard
        sendProgress={progress({
          state: 'complete',
          message: 'Delivered to 150 subscribers across 3 local send groups.',
          groupsDelivered: 3,
          recipientsSent: 150,
          completedAt: '2026-07-27T20:31:00.000Z',
          nextSendAt: undefined,
        })}
      />
    );

    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText(/Delivered to 150 subscribers/)).toBeInTheDocument();
    // Once finished, the projected completion time is no longer interesting.
    expect(screen.queryByText('Expected complete')).not.toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });

  it('calls out a stalled send and names the group to look at', () => {
    render(
      <SendProgressCard
        sendProgress={progress({
          state: 'stalled',
          message: 'Sending — 1 of 3 groups delivered, but 1 group is overdue (London).',
          groups: [
            group(),
            group({
              label: 'Europe/London',
              name: 'London',
              sendAt: '2026-07-27T08:00:00.000Z',
              status: 'pending',
              size: 9,
              recipients: undefined,
              sentAt: undefined,
              overdue: true,
            }),
          ],
        })}
      />
    );

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText(/1 group is overdue \(London\)/)).toBeInTheDocument();
    expect(screen.getByText(/has not reported back/)).toBeInTheDocument();
  });

  it('explains peak-hour groups in their own terms', () => {
    render(
      <SendProgressCard
        sendProgress={progress({
          mode: 'peak-hour',
          defaultTimeZone: undefined,
          groups: [group({ label: 'hour-13', name: '13:00 UTC' })],
        })}
      />
    );

    expect(screen.getByText(/peak open hour/)).toBeInTheDocument();
    expect(screen.queryByText(/wall-clock time in/)).not.toBeInTheDocument();
  });

  it('names the zone the scheduled time was read in for timezone mode', () => {
    render(<SendProgressCard sendProgress={progress()} />);

    expect(screen.getByText(/wall-clock time in America\/Chicago/)).toBeInTheDocument();
  });

  it('falls back to the workflow state when the issue has not fanned out yet', () => {
    const workflow: WorkflowState = {
      state: 'waiting',
      message: 'Scheduled — the publish workflow is waiting for the send time.',
    };

    render(<SendProgressCard workflow={workflow} />);

    expect(screen.getByText(/waiting for the send time/)).toBeInTheDocument();
    // No group list to show, so no progress bar should be claimed.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('surfaces a failure cause when the workflow reports one', () => {
    render(
      <SendProgressCard
        workflow={{
          state: 'failed',
          message: 'The publish workflow failed. This issue was not sent.',
          detail: 'States.Runtime: no such path $.Execution.Input',
        }}
      />
    );

    expect(screen.getByText(/was not sent/)).toBeInTheDocument();
    expect(screen.getByText(/States.Runtime/)).toBeInTheDocument();
  });

  it('prefers send progress over workflow state when both are present', () => {
    render(
      <SendProgressCard
        sendProgress={progress()}
        workflow={{ state: 'running', message: 'Publishing now.' }}
      />
    );

    expect(screen.getByText(/1 of 3 groups delivered/)).toBeInTheDocument();
    expect(screen.queryByText('Publishing now.')).not.toBeInTheDocument();
  });
});
