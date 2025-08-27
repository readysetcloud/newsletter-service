import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmationDialog, useConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { useToast } from '@/components/ui/Toast';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { SkeletonLoader, VerificationProgress, InlineLoading } from '@/components/ui/LoadingStates';
import { senderService } from '@/services/senderService';
import { getUserFriendlyErrorMessage, parseApiError } from '@/utils/errorHandling';
import type { SenderEmail, TierLimits } from '@/types';
import {
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  TrashIcon,
  StarIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { cn } from '@/utils/cn';

interface SenderEmailListProps {
  senders: SenderEmail[];
  tierLimits: TierLimits;
  onSenderDeleted: (senderId: string) => void;
  onSenderUpdated: (sender: SenderEmail) => void;
  isLoading?: boolean;
}

export const SenderEmailList: React.FC<SenderEmailListProps> = ({
  senders,
  tierLimits,
  onSenderDeleted,
  onSenderUpdated,
  isLoading = false,
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [operationErrors, setOperationErrors] = useState<Record<string, string>>({});
  const { showConfirmation, ConfirmationDialog } = useConfirmationDialog();
  const { addToast } = useToast();

  const getStatusIcon = (status: SenderEmail['verificationStatus']) => {
    switch (status) {
      case 'verified':
        return <CheckCircleIcon className="w-5 h-5 text-green-600" />;
      case 'pending':
        return <ClockIcon className="w-5 h-5 text-yellow-600 animate-pulse" />;
      case 'failed':
        return <XCircleIcon className="w-5 h-5 text-red-600" />;
      default:
        return <ClockIcon className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusText = (status: SenderEmail['verificationStatus']) => {
    switch (status) {
      case 'verified':
        return 'Verified';
      case 'pending':
        return 'Pending verification';
      case 'failed':
        return 'Verification failed';
      default:
        return 'Unknown';
    }
  };

  const getStatusBadgeClass = (status: SenderEmail['verificationStatus']) => {
    switch (status) {
      case 'verified':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getVerificationTypeIcon = (type: SenderEmail['verificationType']) => {
    return type === 'domain' ? (
      <GlobeAltIcon className="w-4 h-4" />
    ) : (
      <EnvelopeIcon className="w-4 h-4" />
    );
  };

  const handleDelete = async (sender: SenderEmail) => {
    // Clear any previous errors for this sender
    setOperationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[sender.senderId];
      return newErrors;
    });

    try {
      await showConfirmation({
        title: 'Delete Sender Email',
        description: `Are you sure you want to delete "${sender.email}"? This action cannot be undone.`,
        confirmText: 'Delete Sender',
        type: 'danger',
        isDestructive: true,
        consequences: [
          'The sender email will be permanently removed',
          'SES verification will be cleaned up',
          'You cannot send emails from this address anymore',
          ...(sender.isDefault ? ['You will need to set a new default sender'] : [])
        ],
        details: [
          { label: 'Email', value: sender.email },
          { label: 'Verification Type', value: sender.verificationType },
          { label: 'Status', value: getStatusText(sender.verificationStatus) },
          ...(sender.isDefault ? [{ label: 'Default Sender', value: 'Yes' }] : [])
        ],
        onConfirm: async () => {
          setDeletingId(sender.senderId);
          const response = await senderService.deleteSenderWithRetry(sender.senderId);

          if (response.success) {
            addToast({
              title: 'Sender deleted',
              message: `${sender.email} has been removed successfully`,
              type: 'success'
            });
            onSenderDeleted(sender.senderId);
          } else {
            const errorMessage = getUserFriendlyErrorMessage(response, 'sender');
            setOperationErrors(prev => ({
              ...prev,
              [sender.senderId]: errorMessage
            }));
            throw new Error(errorMessage);
          }
        }
      });
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'sender');
      addToast({
        title: 'Failed to delete sender',
        message: errorMessage,
        type: 'error'
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (sender: SenderEmail) => {
    if (sender.isDefault || sender.verificationStatus !== 'verified') return;

    // Clear any previous errors for this sender
    setOperationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[sender.senderId];
      return newErrors;
    });

    try {
      setUpdatingId(sender.senderId);
      const response = await senderService.updateSenderWithRetry(sender.senderId, {
        isDefault: true
      });

      if (response.success && response.data) {
        addToast({
          title: 'Default sender updated',
          message: `${sender.email} is now your default sender`,
          type: 'success'
        });
        onSenderUpdated(response.data);
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response, 'sender');
        setOperationErrors(prev => ({
          ...prev,
          [sender.senderId]: errorMessage
        }));
        throw new Error(errorMessage);
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'sender');
      addToast({
        title: 'Failed to update default sender',
        message: errorMessage,
        type: 'error'
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRetryVerification = async (sender: SenderEmail) => {
    // Clear any previous errors for this sender
    setOperationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[sender.senderId];
      return newErrors;
    });

    try {
      setUpdatingId(sender.senderId);
      const response = await senderService.retryVerification(sender.senderId);

      if (response.success) {
        addToast({
          title: 'Verification retry initiated',
          message: `Verification process restarted for ${sender.email}`,
          type: 'success'
        });
        if (response.data) {
          onSenderUpdated(response.data);
        }
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response, 'sender');
        setOperationErrors(prev => ({
          ...prev,
          [sender.senderId]: errorMessage
        }));
        throw new Error(errorMessage);
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'sender');
      addToast({
        title: 'Failed to retry verification',
        message: errorMessage,
        type: 'error'
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRefreshStatus = async (sender: SenderEmail) => {
    // Clear any previous errors for this sender
    setOperationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[sender.senderId];
      return newErrors;
    });

    try {
      setRefreshingId(sender.senderId);
      const response = await senderService.getSenderStatus(sender.senderId);

      if (response.success && response.data) {
        // Update the sender with the latest status
        onSenderUpdated(response.data);

        if (response.data.verificationStatus !== sender.verificationStatus) {
          addToast({
            title: 'Status updated',
            message: `${sender.email} status updated to ${response.data.verificationStatus}`,
            type: 'info'
          });
        } else {
          addToast({
            title: 'Status checked',
            message: `${sender.email} verification status is still ${response.data.verificationStatus}`,
            type: 'info'
          });
        }
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response, 'sender');
        setOperationErrors(prev => ({
          ...prev,
          [sender.senderId]: errorMessage
        }));
        throw new Error(errorMessage);
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'sender');
      addToast({
        title: 'Failed to refresh status',
        message: errorMessage,
        type: 'error'
      });
    } finally {
      setRefreshingId(null);
    }
  };

  if (isLoading) {
    return <SkeletonLoader count={3} />;
  }

  if (senders.length === 0) {
    return (
      <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
        <EnvelopeIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No sender emails configured</h3>
        <p className="text-gray-600 mb-6">
          Add your first sender email to start sending newsletters from your own address.
        </p>
        <div className="text-sm text-gray-500">
          <p>You can add up to {tierLimits.maxSenders} sender email{tierLimits.maxSenders !== 1 ? 's' : ''} on your {tierLimits.tier.replace('-', ' ')} plan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {senders.map((sender) => (
        <div
          key={sender.senderId}
          className={cn(
            'bg-white border rounded-lg p-6 transition-all duration-200',
            sender.verificationStatus === 'verified'
              ? 'border-green-200 bg-green-50/30'
              : sender.verificationStatus === 'failed'
              ? 'border-red-200 bg-red-50/30'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 flex-1 min-w-0">
              {/* Status Icon */}
              <div className="flex-shrink-0">
                {getStatusIcon(sender.verificationStatus)}
              </div>

              {/* Email Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-3 mb-1">
                  <h3 className="text-lg font-medium text-gray-900 truncate">
                    {sender.name || sender.email}
                  </h3>
                  {sender.isDefault && (
                    <div className="flex items-center space-x-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                      <StarIconSolid className="w-3 h-3" />
                      <span>Default</span>
                    </div>
                  )}
                </div>

                {sender.name && (
                  <p className="text-sm text-gray-600 truncate mb-1">{sender.email}</p>
                )}

                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <div className="flex items-center space-x-1">
                    {getVerificationTypeIcon(sender.verificationType)}
                    <span className="capitalize">{sender.verificationType} verification</span>
                  </div>

                  {sender.domain && (
                    <div className="flex items-center space-x-1">
                      <GlobeAltIcon className="w-4 h-4" />
                      <span>{sender.domain}</span>
                    </div>
                  )}

                  <div className="flex items-center space-x-1">
                    <span>Added {new Date(sender.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Status Badge and Actions */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              <div className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border',
                getStatusBadgeClass(sender.verificationStatus)
              )}>
                {getStatusText(sender.verificationStatus)}
              </div>

              <div className="flex items-center space-x-2">
                {/* Refresh Status Button - for pending verification */}
                {sender.verificationStatus === 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRefreshStatus(sender)}
                    disabled={refreshingId === sender.senderId}
                    isLoading={refreshingId === sender.senderId}
                    title="Check verification status"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                  </Button>
                )}

                {/* Set as Default Button */}
                {!sender.isDefault && sender.verificationStatus === 'verified' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetDefault(sender)}
                    disabled={updatingId === sender.senderId}
                    isLoading={updatingId === sender.senderId}
                    title="Set as default sender"
                  >
                    <StarIcon className="w-4 h-4" />
                  </Button>
                )}

                {/* Retry Verification Button */}
                {sender.verificationStatus === 'failed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRetryVerification(sender)}
                    disabled={updatingId === sender.senderId}
                    isLoading={updatingId === sender.senderId}
                  >
                    Retry
                  </Button>
                )}

                {/* Delete Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(sender)}
                  disabled={deletingId === sender.senderId}
                  isLoading={deletingId === sender.senderId}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  title="Delete sender email"
                >
                  <TrashIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Failure Reason */}
          {sender.verificationStatus === 'failed' && sender.failureReason && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">
                <strong>Verification failed:</strong> {sender.failureReason}
              </p>
            </div>
          )}

          {/* Operation Error Display */}
          {operationErrors[sender.senderId] && (
            <div className="mt-4">
              <ErrorDisplay
                title="Operation Failed"
                message={operationErrors[sender.senderId]}
                severity="error"
                retryable={parseApiError({ error: operationErrors[sender.senderId] }).retryable}
                onRetry={() => {
                  setOperationErrors(prev => {
                    const newErrors = { ...prev };
                    delete newErrors[sender.senderId];
                    return newErrors;
                  });
                }}
                compact={true}
              />
            </div>
          )}

          {/* Verification Progress */}
          {(sender.verificationStatus === 'pending' || sender.verificationStatus === 'failed') && (
            <div className="mt-4">
              <VerificationProgress
                type={sender.verificationType === 'domain' ? 'domain' : 'email'}
                status={sender.verificationStatus}
                email={sender.verificationType === 'mailbox' ? sender.email : undefined}
                domain={sender.verificationType === 'domain' ? sender.domain : undefined}
                estimatedTime={
                  sender.verificationType === 'mailbox'
                    ? 'Verification usually completes within a few minutes'
                    : 'DNS verification can take up to 72 hours'
                }
                onRetry={sender.verificationStatus === 'failed' ? () => handleRetryVerification(sender) : undefined}
              />
            </div>
          )}
        </div>
      ))}

      <ConfirmationDialog />
    </div>
  );
};
