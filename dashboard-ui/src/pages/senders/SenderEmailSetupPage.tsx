import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay, NetworkError } from '@/components/ui/ErrorDisplay';
import { LoadingOverlay, ProgressIndicator, EmptyState, LoadingSpinner } from '@/components/ui/LoadingStates';

import {
  SenderEmailList,
  AddSenderForm,
  DomainVerificationGuide,
  TierUpgradePrompt,
  type SenderEmail,
  type TierLimits,
  type DomainVerification,
  type CreateSenderRequest,
  type UpdateSenderRequest,
  type GetSendersResponse
} from '@/components/senders';
import { senderService } from '@/services/senderService';
import { useNotifications } from '@/hooks/useNotifications';
import { useAuth } from '@/contexts/AuthContext';
import { getUserFriendlyErrorMessage, parseApiError } from '@/utils/errorHandling';
import type { Notification } from '@/types';
import {
  EnvelopeIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  WifiIcon,
  XCircleIcon,
  SparklesIcon,
  ArrowUpIcon,
} from '@heroicons/react/24/outline';

interface SenderSetupState {
  senders: SenderEmail[];
  tierLimits: TierLimits;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  selectedSender: SenderEmail | null;
  showAddForm: boolean;
  showDomainGuide: boolean;
  domainVerification: DomainVerification | null;
  verifyingDomain: string | null;
  pollingStatuses: Set<string>; // Track which senders are being polled
  operationInProgress: {
    type: 'create' | 'update' | 'delete' | 'verify' | null;
    senderId?: string;
    message?: string;
  };
  verificationProgress: Array<{
    id: string;
    label: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    description?: string;
  }>;
}

export function SenderEmailSetupPage() {
  const { user } = useAuth();
  const { showSuccess, showError, showInfo, isSubscribed } = useNotifications();
  const navigate = useNavigate();

  const [state, setState] = useState<SenderSetupState>({
    senders: [],
    tierLimits: {
      tier: 'free-tier',
      maxSenders: 1,
      currentCount: 0,
      canUseDNS: false,
      canUseMailbox: true
    },
    isLoading: true,
    isRefreshing: false,
    error: null,
    selectedSender: null,
    showAddForm: false,
    showDomainGuide: false,
    domainVerification: null,
    verifyingDomain: null,
    pollingStatuses: new Set(),
    operationInProgress: { type: null },
    verificationProgress: []
  });

  // Load sender data on component mount
  useEffect(() => {
    loadSenders();
  }, []);

  // Handle real-time notifications for sender verification updates
  const handleSenderNotification = useCallback((notification: Notification) => {
    // Check if this is a sender-related notification
    const isSenderNotification =
      notification.title.toLowerCase().includes('sender') ||
      notification.title.toLowerCase().includes('domain') ||
      notification.title.toLowerCase().includes('verification') ||
      notification.title.toLowerCase().includes('email verified') ||
      notification.title.toLowerCase().includes('email failed');

    if (isSenderNotification) {
      // Refresh sender data when verification status changes
      loadSenders();

      // Show appropriate notification based on type
      switch (notification.type) {
        case 'success':
          showSuccess(notification.title, notification.message);
          break;
        case 'error':
          showError(notification.title, notification.message);
          break;
        case 'info':
          showInfo(notification.title, notification.message);
          break;
        default:
          showInfo(notification.title, notification.message);
      }
    }
  }, [showSuccess, showError, showInfo]);

  // Set up real-time notification handling
  useEffect(() => {
    // The NotificationContext already handles the connection setup
    // We just need to listen for notifications that affect senders
    // This is handled through the notification system automatically

    // Note: Real-time updates are handled by the NotificationContext
    // and will trigger re-renders when sender status changes
  }, []);

  const loadSenders = async (isRefresh = false) => {
    try {
      setState(prev => ({
        ...prev,
        isLoading: !isRefresh,
        isRefreshing: isRefresh,
        error: null
      }));

      const response = await senderService.getSendersWithRetry();

      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          senders: response.data!.senders,
          tierLimits: response.data!.tierLimits,
          isLoading: false,
          isRefreshing: false
        }));
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response, 'sender');
        setState(prev => ({
          ...prev,
          error: errorMessage,
          isLoading: false,
          isRefreshing: false
        }));
      }
    } catch (err) {
      const errorMessage = getUserFriendlyErrorMessage(err, 'sender');
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isLoading: false,
        isRefreshing: false
      }));
    }
  };

  const handleRefresh = () => {
    loadSenders(true);
  };

  const handleCreateSender = async (sender: SenderEmail) => {
    // Add new sender to state and hide the form to show the sender list
    setState(prev => ({
      ...prev,
      senders: [...prev.senders, sender],
      tierLimits: {
        ...prev.tierLimits,
        currentCount: prev.tierLimits.currentCount + 1
      },
      showAddForm: false, // Hide the form to show the sender list
      operationInProgress: { type: null }
    }));

    // Add to polling statuses for UI feedback
    setState(prev => ({
      ...prev,
      pollingStatuses: new Set([...prev.pollingStatuses, sender.senderId])
    }));

    // Start polling for verification status with enhanced feedback
    senderService.startVerificationPolling(
      sender.senderId,
      (updatedSender, error) => {
        if (error) {
          showError('Verification Error', error);
          // Remove from polling statuses
          setState(prev => ({
            ...prev,
            pollingStatuses: new Set([...prev.pollingStatuses].filter(id => id !== sender.senderId))
          }));
        } else if (updatedSender) {
          // Update sender in state
          setState(prev => ({
            ...prev,
            senders: prev.senders.map(s =>
              s.senderId === updatedSender.senderId ? updatedSender : s
            )
          }));

          if (updatedSender.verificationStatus === 'verified') {
            showSuccess(
              'Email Verified',
              `${updatedSender.email} has been successfully verified and is ready to use`
            );
            // Remove from polling statuses
            setState(prev => ({
              ...prev,
              pollingStatuses: new Set([...prev.pollingStatuses].filter(id => id !== updatedSender.senderId))
            }));
          } else if (updatedSender.verificationStatus === 'failed') {
            showError(
              'Verification Failed',
              `Failed to verify ${updatedSender.email}. ${updatedSender.failureReason || 'Please check your email and try again.'}`
            );
            // Remove from polling statuses
            setState(prev => ({
              ...prev,
              pollingStatuses: new Set([...prev.pollingStatuses].filter(id => id !== updatedSender.senderId))
            }));
          }
        }
      }
    );
  };

  const handleUpdateSender = async (senderId: string, data: UpdateSenderRequest) => {
    try {
      const response = await senderService.updateSenderWithRetry(senderId, data);

      if (response.success && response.data) {
        // Update sender in state
        setState(prev => ({
          ...prev,
          senders: prev.senders.map(s =>
            s.senderId === senderId ? response.data! : s
          )
        }));

        showSuccess(
          'Sender Updated',
          'Sender email updated successfully'
        );
      } else {
        throw new Error(response.error || 'Failed to update sender email');
      }
    } catch (err) {
      showError(
        'Error',
        err instanceof Error ? err.message : 'Failed to update sender email'
      );
      throw err;
    }
  };

  const handleDeleteSender = async (senderId: string) => {
    try {
      const response = await senderService.deleteSender(senderId);

      if (response.success) {
        // Remove sender from state
        setState(prev => ({
          ...prev,
          senders: prev.senders.filter(s => s.senderId !== senderId),
          tierLimits: {
            ...prev.tierLimits,
            currentCount: Math.max(0, prev.tierLimits.currentCount - 1)
          }
        }));

        // Stop polling for this sender
        senderService.stopVerificationPolling(senderId);

        showSuccess(
          'Sender Deleted',
          'Sender email deleted successfully'
        );
      } else {
        throw new Error(response.error || 'Failed to delete sender email');
      }
    } catch (err) {
      showError(
        'Error',
        err instanceof Error ? err.message : 'Failed to delete sender email'
      );
      throw err;
    }
  };

  const handleVerifyDomain = async (domain: string) => {
    try {
      setState(prev => ({ ...prev, verifyingDomain: domain }));

      const response = await senderService.verifyDomainWithRetry({ domain });

      if (response.success && response.data) {
        setState(prev => ({
          ...prev,
          domainVerification: response.data!,
          showDomainGuide: true,
          verifyingDomain: null
        }));

        // Add domain to polling statuses for UI feedback
        setState(prev => ({
          ...prev,
          pollingStatuses: new Set([...prev.pollingStatuses, `domain:${domain}`])
        }));

        // Start polling for domain verification status
        senderService.startDomainVerificationPolling(
          domain,
          (verification, error) => {
            if (error) {
              showError('Domain Verification Error', error);
              // Remove from polling statuses
              setState(prev => ({
                ...prev,
                pollingStatuses: new Set([...prev.pollingStatuses].filter(id => id !== `domain:${domain}`))
              }));
            } else if (verification) {
              setState(prev => ({
                ...prev,
                domainVerification: verification
              }));

              if (verification.verificationStatus === 'verified') {
                showSuccess(
                  'Domain Verified',
                  `${domain} has been successfully verified`
                );
                // Remove from polling statuses
                setState(prev => ({
                  ...prev,
                  pollingStatuses: new Set([...prev.pollingStatuses].filter(id => id !== `domain:${domain}`))
                }));
                // Refresh senders to show updated status
                loadSenders();
              } else if (verification.verificationStatus === 'failed') {
                showError(
                  'Domain Verification Failed',
                  `Failed to verify ${domain}. Please check your DNS records.`
                );
                // Remove from polling statuses
                setState(prev => ({
                  ...prev,
                  pollingStatuses: new Set([...prev.pollingStatuses].filter(id => id !== `domain:${domain}`))
                }));
              }
            }
          }
        );

        showInfo(
          'Domain Verification Started',
          `DNS records generated for ${domain}. Please add them to your DNS settings.`
        );
      } else {
        throw new Error(response.error || 'Failed to initiate domain verification');
      }
    } catch (err) {
      setState(prev => ({ ...prev, verifyingDomain: null }));
      showError(
        'Error',
        err instanceof Error ? err.message : 'Failed to verify domain'
      );
      throw err;
    }
  };

  const handleRetryVerification = async (senderId: string) => {
    try {
      const response = await senderService.retryVerification(senderId);

      if (response.success && response.data) {
        // Update sender in state
        setState(prev => ({
          ...prev,
          senders: prev.senders.map(s =>
            s.senderId === senderId ? response.data! : s
          )
        }));

        // Note: Verification status is now checked automatically by the backend
        // No need for aggressive polling - status updates will be reflected on page refresh

        showSuccess(
          'Status Refreshed',
          'Verification status has been updated. The system will automatically check verification progress.'
        );
      } else {
        throw new Error(response.error || 'Failed to refresh verification status');
      }
    } catch (err) {
      showError(
        'Error',
        err instanceof Error ? err.message : 'Failed to refresh verification status'
      );
    }
  };

  // Handle upgrade navigation
  const handleUpgrade = () => {
    navigate('/billing');
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      senderService.stopAllPolling();
    };
  }, []);

  if (state.isLoading && state.senders.length === 0) {
    return (
      <div className="max-w-7xl mx-auto">
        <LoadingOverlay
          isLoading={true}
          message="Loading sender email configuration..."
        >
          <div className="space-y-6">
            <div className="h-20 bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="h-32 bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="h-64 bg-gray-200 rounded-lg animate-pulse"></div>
          </div>
        </LoadingOverlay>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
          {state.error && state.senders.length === 0 ? (
            <div className="space-y-6">
              {/* Page Header */}
              <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Sender Email Setup</h1>
                <p className="text-gray-600 mt-2 text-sm sm:text-base">
                  Configure verified email addresses for sending newsletters.
                </p>
              </div>

              {/* Error Display */}
              {parseApiError({ error: state.error }).type === 'network' ? (
                <NetworkError onRetry={() => loadSenders()} />
              ) : (
                <ErrorDisplay
                  title="Error Loading Sender Emails"
                  message={state.error}
                  severity="error"
                  retryable={parseApiError({ error: state.error }).retryable}
                  onRetry={() => loadSenders()}
                  suggestions={[
                    'Check your internet connection',
                    'Refresh the page',
                    'Try again in a few moments',
                    'Contact support if the problem persists'
                  ]}
                />
              )}
            </div>
          ) : (
            <>
              {/* Page Header */}
              <div className="mb-6 sm:mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Sender Email Setup</h1>
                    <p className="text-gray-600 mt-2 text-sm sm:text-base">
                      Configure verified email addresses for sending newsletters.
                      {state.tierLimits.tier === 'free-tier' && ' Upgrade to unlock DNS verification and multiple senders.'}
                    </p>
                  </div>

                  {/* Status Indicator */}
                  <div className="flex items-center space-x-4">
                    {state.isRefreshing && (
                      <div className="flex items-center space-x-2 text-sm text-blue-600">
                        <LoadingSpinner size="sm" />
                        <span>Refreshing...</span>
                      </div>
                    )}
                    {state.pollingStatuses.size > 0 && (
                      <div className="flex items-center space-x-2 text-sm text-blue-600">
                        <ClockIcon className="w-4 h-4 animate-pulse" />
                        <span>Checking verification status...</span>
                      </div>
                    )}
                    <button
                      onClick={handleRefresh}
                      disabled={state.isRefreshing}
                      className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                      title="Refresh sender status"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              {/* Tier Information */}
              <div className="mb-6">
                {!senderService.canAddSender(state.tierLimits) ? (
                  /* Show upgrade prompt when limit reached */
                  <TierUpgradePrompt
                    currentTier={state.tierLimits}
                    context="sender-limit"
                    feature="sender emails"
                    variant="card"
                    onUpgrade={handleUpgrade}
                  />
                ) : (
                  /* Show balanced tier info when user can still add senders */
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Current Plan Info */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <EnvelopeIcon className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-blue-800">
                            Current Plan: {state.tierLimits.tier.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </h3>
                          <p className="text-sm text-blue-600">
                            {state.tierLimits.currentCount} of {state.tierLimits.maxSenders} sender emails configured
                          </p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs text-blue-700 mb-1">
                          <span>Usage</span>
                          <span>{Math.round((state.tierLimits.currentCount / state.tierLimits.maxSenders) * 100)}%</span>
                        </div>
                        <div className="w-full bg-blue-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(state.tierLimits.currentCount / state.tierLimits.maxSenders) * 100}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Current plan features */}
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center space-x-2 text-blue-700">
                          <CheckCircleIcon className="w-4 h-4 text-green-600" />
                          <span>{state.tierLimits.maxSenders} sender email{state.tierLimits.maxSenders !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center space-x-2 text-blue-700">
                          {state.tierLimits.canUseMailbox ? (
                            <CheckCircleIcon className="w-4 h-4 text-green-600" />
                          ) : (
                            <XCircleIcon className="w-4 h-4 text-gray-400" />
                          )}
                          <span>Email verification</span>
                        </div>
                        <div className="flex items-center space-x-2 text-blue-700">
                          {state.tierLimits.canUseDNS ? (
                            <CheckCircleIcon className="w-4 h-4 text-green-600" />
                          ) : (
                            <XCircleIcon className="w-4 h-4 text-gray-400" />
                          )}
                          <span>Domain verification</span>
                        </div>
                      </div>
                    </div>

                    {/* Upgrade Preview */}
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                          <SparklesIcon className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-purple-800">
                            Unlock More Features
                          </h3>
                          <p className="text-sm text-purple-600">
                            Upgrade to get more sender emails and advanced features
                          </p>
                        </div>
                      </div>

                      {/* Next tier preview */}
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex items-center space-x-2 text-purple-700">
                          <ArrowUpIcon className="w-4 h-4 text-purple-600" />
                          <span>Up to 5 sender emails</span>
                        </div>
                        <div className="flex items-center space-x-2 text-purple-700">
                          <ArrowUpIcon className="w-4 h-4 text-purple-600" />
                          <span>Domain verification</span>
                        </div>
                        <div className="flex items-center space-x-2 text-purple-700">
                          <ArrowUpIcon className="w-4 h-4 text-purple-600" />
                          <span>Advanced analytics</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          // TODO: Implement upgrade flow
                          console.log('Upgrade clicked');
                        }}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium py-2 px-4 rounded-md transition-colors"
                      >
                        View Upgrade Options
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Operation Progress */}
              {state.operationInProgress.type && (
                <div className="mb-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center space-x-3">
                      <LoadingSpinner size="sm" />
                      <div>
                        <h4 className="text-sm font-medium text-blue-800">
                          Operation in Progress
                        </h4>
                        <p className="text-sm text-blue-600">
                          {state.operationInProgress.message}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Verification Progress */}
              {state.verificationProgress.length > 0 && (
                <div className="mb-6">
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">
                      Verification Progress
                    </h4>
                    <ProgressIndicator progress={50} />
                  </div>
                </div>
              )}

              {/* Error Display for Partial Failures */}
              {state.error && state.senders.length > 0 && (
                <div className="mb-6">
                  <ErrorDisplay
                    title="Some operations failed"
                    message={state.error}
                    severity="warning"
                    retryable={parseApiError({ error: state.error }).retryable}
                    onRetry={handleRefresh}
                    onDismiss={() => setState(prev => ({ ...prev, error: null }))}
                    compact={true}
                  />
                </div>
              )}

              {/* Sender Email List */}
              <div className="mb-6">
                {state.senders.length === 0 && !state.isLoading ? (
                  <EmptyState
                    title="No sender emails configured"
                    description="Add your first sender email to start sending newsletters from your own address."
                  />
                ) : (
                  <SenderEmailList
                    senders={state.senders}
                    tierLimits={state.tierLimits}
                    onSenderDeleted={(senderId) => {
                      setState(prev => ({
                        ...prev,
                        senders: prev.senders.filter(s => s.senderId !== senderId),
                        tierLimits: {
                          ...prev.tierLimits,
                          currentCount: Math.max(0, prev.tierLimits.currentCount - 1)
                        }
                      }));
                    }}
                    onSenderUpdated={(sender) => {
                      setState(prev => ({
                        ...prev,
                        senders: prev.senders.map(s =>
                          s.senderId === sender.senderId ? sender : s
                        )
                      }));
                    }}
                    isLoading={state.isLoading}
                  />
                )}
              </div>

              {/* Add Sender Form */}
              {state.showAddForm && (
                <div className="mb-6">
                  <AddSenderForm
                    tierLimits={state.tierLimits}
                    existingSenders={state.senders}
                    onSenderCreated={handleCreateSender}
                    onCancel={() => setState(prev => ({ ...prev, showAddForm: false }))}
                    onUpgrade={handleUpgrade}
                  />
                </div>
              )}

              {/* Domain Verification Guide */}
              {state.showDomainGuide && state.domainVerification && (
                <div className="mb-6">
                  <DomainVerificationGuide
                    domain={state.domainVerification.domain}
                    onClose={() => setState(prev => ({
                      ...prev,
                      showDomainGuide: false,
                      domainVerification: null
                    }))}
                    onVerificationComplete={() => {
                      if (state.domainVerification) {
                        senderService.getDomainVerification(state.domainVerification.domain)
                          .then(response => {
                            if (response.success && response.data) {
                              setState(prev => ({
                                ...prev,
                                domainVerification: response.data!
                              }));
                            }
                          });
                      }
                    }}
                  />
                </div>
              )}

              {/* Add Sender Button - Only show if user has existing senders */}
              {!state.showAddForm && senderService.canAddSender(state.tierLimits) && state.senders.length > 0 && (
                <div className="text-center">
                  <button
                    onClick={() => setState(prev => ({ ...prev, showAddForm: true }))}
                    className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors font-medium"
                  >
                    Add Another Sender Email
                  </button>
                </div>
              )}

              {/* Tier Upgrade Prompt for No Senders */}
              {state.senders.length === 0 && !senderService.canAddSender(state.tierLimits) && (
                <div className="text-center">
                  <TierUpgradePrompt
                    currentTier={state.tierLimits}
                    context="sender-limit"
                    feature="sender emails"
                    variant="card"
                    onUpgrade={handleUpgrade}
                  />
                </div>
              )}
            </>
          )}
    </div>
  );
}
