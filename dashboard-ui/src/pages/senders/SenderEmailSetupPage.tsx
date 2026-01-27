import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { ErrorDisplay, NetworkError } from '@/components/ui/ErrorDisplay';
import { LoadingOverlay, ProgressIndicator, EmptyState, LoadingSpinner } from '@/components/ui/LoadingStates';

import {
  SenderEmailList,
  AddSenderForm,
  DomainVerificationGuide,
  TierUpgradePrompt,
  type SenderEmail,
  type TierLimits,
  type DomainVerification
} from '@/components/senders';
import { senderService } from '@/services/senderService';
import { useToast } from '@/components/ui/Toast';
import { getUserFriendlyErrorMessage, parseApiError } from '@/utils/errorHandling';
import {
  EnvelopeIcon,
  CheckCircleIcon,
  ClockIcon,
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
  const { addToast } = useToast();
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

  const showSuccess = useCallback((title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  }, [addToast]);

  const showError = useCallback((title: string, message?: string) => {
    addToast({ type: 'error', title, message });
  }, [addToast]);

  const loadSenders = useCallback(async (isRefresh = false) => {
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
  }, []);

  // Load sender data on component mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSenders();
  }, [loadSenders]);

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
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            <LoadingOverlay
              isLoading={true}
              message="Loading sender email configuration..."
            >
              <div className="space-y-6">
                <div className="h-20 bg-muted rounded-lg animate-pulse"></div>
                <div className="h-32 bg-muted rounded-lg animate-pulse"></div>
                <div className="h-64 bg-muted rounded-lg animate-pulse"></div>
              </div>
            </LoadingOverlay>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {state.error && state.senders.length === 0 ? (
            <div className="space-y-6">
              {/* Page Header */}
              <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Sender Email Setup</h1>
                <p className="text-muted-foreground mt-2 text-sm sm:text-base">
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
                    <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Sender Email Setup</h1>
                    <p className="text-muted-foreground mt-2 text-sm sm:text-base">
                      Configure verified email addresses for sending newsletters.
                      {state.tierLimits.tier === 'free-tier' && ' Upgrade to unlock DNS verification and multiple senders.'}
                    </p>
                  </div>

                  {/* Status Indicator */}
                  <div className="flex items-center space-x-4">
                    {state.isRefreshing && (
                      <div className="flex items-center space-x-2 text-sm text-primary-600">
                        <LoadingSpinner size="sm" />
                        <span>Refreshing...</span>
                      </div>
                    )}
                    {state.pollingStatuses.size > 0 && (
                      <div className="flex items-center space-x-2 text-sm text-primary-600">
                        <ClockIcon className="w-4 h-4 animate-pulse" />
                        <span>Checking verification status...</span>
                      </div>
                    )}
                    <button
                      onClick={handleRefresh}
                      disabled={state.isRefreshing}
                      className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
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
                    <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                          <EnvelopeIcon className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-primary-800">
                            Current Plan: {state.tierLimits.tier.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </h3>
                          <p className="text-sm text-primary-600">
                            {state.tierLimits.currentCount} of {state.tierLimits.maxSenders} sender emails configured
                          </p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs text-primary-700 mb-1">
                          <span>Usage</span>
                          <span>{Math.round((state.tierLimits.currentCount / state.tierLimits.maxSenders) * 100)}%</span>
                        </div>
                        <div className="w-full bg-primary-200 rounded-full h-2">
                          <div
                            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(state.tierLimits.currentCount / state.tierLimits.maxSenders) * 100}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Current plan features */}
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center space-x-2 text-primary-700">
                          <CheckCircleIcon className="w-4 h-4 text-success-600" />
                          <span>{state.tierLimits.maxSenders} sender email{state.tierLimits.maxSenders !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center space-x-2 text-primary-700">
                          {state.tierLimits.canUseMailbox ? (
                            <CheckCircleIcon className="w-4 h-4 text-success-600" />
                          ) : (
                            <XCircleIcon className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span>Email verification</span>
                        </div>
                        <div className="flex items-center space-x-2 text-primary-700">
                          {state.tierLimits.canUseDNS ? (
                            <CheckCircleIcon className="w-4 h-4 text-success-600" />
                          ) : (
                            <XCircleIcon className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span>Domain verification</span>
                        </div>
                      </div>
                    </div>

                    {/* Upgrade Preview */}
                    <div className="bg-gradient-to-r from-primary-50 to-background border border-primary-200 rounded-lg p-4">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                          <SparklesIcon className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-foreground">
                            Unlock More Features
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            Upgrade to get more sender emails and advanced features
                          </p>
                        </div>
                      </div>

                      {/* Next tier preview */}
                      <div className="space-y-2 text-sm mb-4">
                        <div className="flex items-center space-x-2 text-primary-700">
                          <ArrowUpIcon className="w-4 h-4 text-primary-600" />
                          <span>Up to 5 sender emails</span>
                        </div>
                        <div className="flex items-center space-x-2 text-primary-700">
                          <ArrowUpIcon className="w-4 h-4 text-primary-600" />
                          <span>Domain verification</span>
                        </div>
                        <div className="flex items-center space-x-2 text-primary-700">
                          <ArrowUpIcon className="w-4 h-4 text-primary-600" />
                          <span>Advanced analytics</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          // TODO: Implement upgrade flow
                          console.log('Upgrade clicked');
                        }}
                        className="w-full bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium py-2 px-4 rounded-md transition-colors"
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
                  <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                    <div className="flex items-center space-x-3">
                      <LoadingSpinner size="sm" />
                      <div>
                        <h4 className="text-sm font-medium text-primary-800">
                          Operation in Progress
                        </h4>
                        <p className="text-sm text-primary-600">
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
                  <div className="bg-surface border border-border rounded-lg p-4">
                    <h4 className="text-sm font-medium text-foreground mb-3">
                      Verification Progress
                    </h4>
                    <ProgressIndicator steps={state.verificationProgress} />
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
                    icon={<EnvelopeIcon className="w-12 h-12 text-muted-foreground" />}
                    action={
                      senderService.canAddSender(state.tierLimits) ? {
                        label: "Add Sender Email",
                        onClick: () => setState(prev => ({ ...prev, showAddForm: true })),
                        isLoading: state.operationInProgress.type === 'create'
                      } : undefined
                    }
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
                    className="bg-primary-600 text-white px-6 py-3 rounded-md hover:bg-primary-700 transition-colors font-medium"
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
      </main>
    </div>
  );
}
