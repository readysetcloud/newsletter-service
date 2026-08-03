import React, { useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter
} from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { Issue } from '@/types/issues';

export interface ResendIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The published issue that never reached anyone. */
  issue: Pick<Issue, 'issueNumber' | 'subject'>;
  /** How many subscribers the issue was published against, when known. */
  subscribers?: number;
  /** Performs the resend. Rejects to keep the dialog open with the error shown. */
  onSubmit: () => Promise<void>;
}

/**
 * Sends a published issue that never actually went out.
 *
 * The case this exists for: the publish workflow finished and wrote
 * `published`, but the send that was supposed to follow it never fired, so the
 * issue reads as sent while nobody received it. Nothing recovers from that on
 * its own — the workflow is over and its record says it succeeded.
 *
 * The dialog is a plain confirmation rather than a form because there is
 * nothing to choose. It does spell out the audience rule, which is the thing an
 * operator most needs to trust before pressing it: the send path skips any
 * subscriber whose last-sent marker already names this issue, so a resend
 * reaches exactly the people who never got it. For an issue that sent to nobody
 * that is everyone; for one that partly went out it is the remainder.
 */
export const ResendIssueDialog: React.FC<ResendIssueDialogProps> = ({
  isOpen,
  onClose,
  issue,
  subscribers,
  onSubmit
}) => {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send this issue again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <form onSubmit={handleSubmit}>
        <ModalHeader onClose={handleClose}>
          <ModalTitle>Send this issue again</ModalTitle>
          <ModalDescription>
            Issue #{issue.issueNumber} is marked published, but no email was ever handed to the
            mail provider for it.
          </ModalDescription>
        </ModalHeader>

        <ModalContent>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Send className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Who this reaches
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Only subscribers who never received this issue
                {typeof subscribers === 'number' && subscribers > 0
                  ? ` — up to ${subscribers.toLocaleString()} of them`
                  : ''}
                . Anyone who already got it is skipped automatically, so this cannot send a
                duplicate.
              </p>
            </div>

            <div className="rounded-lg border border-warning-200 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-900/20 p-4">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <AlertTriangle
                  className="h-4 w-4 text-warning-600 dark:text-warning-500"
                  aria-hidden="true"
                />
                What this replaces
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                The issue sends with its content as it stands now, not as it stood when it was
                first published. Per-timezone delivery progress from the previous attempt is
                cleared so the new send can be tracked.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-error-600">
                {error}
              </p>
            )}
          </div>
        </ModalContent>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send it again'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
