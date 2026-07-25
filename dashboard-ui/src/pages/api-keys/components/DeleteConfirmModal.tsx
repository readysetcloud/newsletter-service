import React from 'react';
import { ConfirmationDialog, confirmationPresets } from '@/components/ui/ConfirmationDialog';
import type { ApiKey } from '@/types';
import { formatInTimeZone } from '@/utils/dateFormatting';
import { useTenantDateFormat } from '@/contexts/SettingsContext';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  apiKey: Omit<ApiKey, 'keyValue'>;
  isRevoke: boolean;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  apiKey,
  isRevoke,
}) => {
  // Dates render in the newsletter's timezone, not the viewer's.
  const { timeZone } = useTenantDateFormat();
  const confirmationProps = isRevoke
    ? confirmationPresets.revokeApiKey(apiKey.name)
    : confirmationPresets.deleteApiKey(apiKey.name);

  // Add additional details specific to this API key
  const enhancedDetails = [
    { label: 'Name', value: apiKey.name },
    ...(apiKey.description ? [{ label: 'Description', value: apiKey.description }] : []),
    { label: 'Created', value: formatInTimeZone(apiKey.createdAt, timeZone, {}) },
    { label: 'Usage Count', value: `${apiKey.usageCount} request${apiKey.usageCount !== 1 ? 's' : ''}` },
    ...(apiKey.lastUsed ? [{ label: 'Last Used', value: formatInTimeZone(apiKey.lastUsed, timeZone, {}) }] : [])
  ];

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      {...confirmationProps}
      details={enhancedDetails}
      loadingText={isRevoke ? 'Revoking...' : 'Deleting...'}
    />
  );
};
