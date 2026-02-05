import React from 'react';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import type { Issue } from '../../types/issues';

/**
 * Props for the DeleteIssueDialog component
 */
export interface DeleteIssueDialogProps {
  /** Whether the dialog is currently open */
  isOpen: boolean;
  /** Callback function to close the dialog */
  onClose: () => void;
  /** Async callback function to execute when deletion is confirmed */
  onConfirm: () => Promise<void>;
  /** The issue to be deleted, or null if no issue is selected */
  issue: Issue | null;
}

/**
 * Confirmation dialog for deleting an issue
 * Displays issue details and requires text confirmation before deletion
 * Shows consequences and requires typing "DELETE" to confirm
 */
export const DeleteIssueDialog: React.FC<DeleteIssueDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  issue
}) => {
  if (!issue) return null;

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete Issue"
      description="This action cannot be undone. The issue will be permanently removed from the system."
      confirmText="Delete Issue"
      cancelText="Cancel"
      type="danger"
      isDestructive
      requireTextConfirmation
      confirmationText="DELETE"
      consequences={[
        'The issue will be permanently deleted',
        'All issue data will be lost',
        'This action cannot be undone'
      ]}
      details={[
        { label: 'Issue Subject', value: issue.subject },
        { label: 'Issue Number', value: `#${issue.issueNumber}` },
        { label: 'Status', value: issue.status }
      ]}
    />
  );
};
