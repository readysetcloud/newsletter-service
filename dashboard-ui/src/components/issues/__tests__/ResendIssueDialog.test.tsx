import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResendIssueDialog } from '../ResendIssueDialog';
import type { Issue } from '@/types/issues';

const issue = {
  issueNumber: 227,
  subject: 'Issue 227'
} as Pick<Issue, 'issueNumber' | 'subject'>;

const renderDialog = (
  onSubmit = vi.fn().mockResolvedValue(undefined),
  props: { onClose?: () => void; subscribers?: number } = {}
) => {
  render(
    <ResendIssueDialog
      isOpen
      onClose={props.onClose ?? vi.fn()}
      issue={issue}
      subscribers={props.subscribers}
      onSubmit={onSubmit}
    />
  );
  return onSubmit;
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: /send it again/i }));

describe('ResendIssueDialog', () => {
  it('names the issue and why it is being offered', () => {
    renderDialog();

    expect(screen.getByText(/#227/)).toBeInTheDocument();
    expect(screen.getByText(/no email was ever handed to the mail provider/i)).toBeInTheDocument();
  });

  // The audience rule is the thing an operator has to trust before pressing
  // this, so it is stated in the dialog rather than left to the release notes.
  it('states that subscribers who already received it are skipped', () => {
    renderDialog();

    expect(screen.getByText(/only subscribers who never received this issue/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot send a duplicate/i)).toBeInTheDocument();
  });

  it('quantifies the audience when the subscriber count is known', () => {
    renderDialog(vi.fn().mockResolvedValue(undefined), { subscribers: 1234 });

    expect(screen.getByText(/up to 1,234 of them/i)).toBeInTheDocument();
  });

  it('omits the count rather than claiming zero when it is unknown', () => {
    renderDialog();

    expect(screen.queryByText(/up to/i)).not.toBeInTheDocument();
  });

  it('submits once confirmed', async () => {
    const onSubmit = renderDialog();

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  // A rejected submit has to leave the dialog open with the reason visible —
  // the alternative is a closed dialog and an issue that still has not sent.
  it('keeps the dialog open and shows why when the send is refused', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Only published issues can be resent'));
    renderDialog(onSubmit);

    submit();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Only published issues can be resent')
    );
    expect(screen.getByRole('button', { name: /send it again/i })).toBeInTheDocument();
  });

  it('does not close while a send is in flight', () => {
    const onClose = vi.fn();
    renderDialog(vi.fn(() => new Promise<void>(() => {})), { onClose });

    submit();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).not.toHaveBeenCalled();
  });

  // Double-sending is the one thing worse than not sending, and the idempotency
  // filter only protects across sends that have already recorded a recipient —
  // two in flight at once are not covered by it. The submit button disabling
  // itself is the guard.
  it('cannot be submitted twice while the first send is in flight', () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    renderDialog(onSubmit);

    const button = screen.getByRole('button', { name: /send it again/i });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Sending…');

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
