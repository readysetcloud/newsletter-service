import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ErrorDisplay, NetworkError } from '@/components/ui/ErrorDisplay';
import { LoadingOverlay } from '@/components/ui/LoadingStates';
import { senderService } from '@/services/senderService';
import { getUserFriendlyErrorMessage, parseApiError } from '@/utils/errorHandling';
import type { DomainVerification } from '@/types';
import {
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

interface DomainVerificationGuideProps {
  domain: string;
  onVerificationComplete?: (verification: DomainVerification) => void;
  onClose?: () => void;
  className?: string;
}

export const DomainVerificationGuide: React.FC<DomainVerificationGuideProps> = ({
  domain,
  onVerificationComplete,
  onClose,
  className
}) => {
  const [verification, setVerification] = useState<DomainVerification | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedRecord, setCopiedRecord] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { addToast } = useToast();

  const loadDomainVerification = useCallback(async (showToast = false) => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await senderService.getDomainVerificationWithRetry(domain);
      if (response.success && response.data) {
        setVerification(response.data);

        if (showToast) {
          addToast({
            title: 'Verification status updated',
            message: 'Domain verification information has been refreshed',
            type: 'success'
          });
        }
      } else {
        const errorMessage = getUserFriendlyErrorMessage(response, 'sender');
        setLoadError(errorMessage);

        if (showToast) {
          addToast({
            title: 'Failed to refresh verification status',
            message: errorMessage,
            type: 'error'
          });
        }
      }
    } catch (error) {
      const errorMessage = getUserFriendlyErrorMessage(error, 'sender');
      setLoadError(errorMessage);

      if (showToast) {
        addToast({
          title: 'Failed to load domain verification',
          message: errorMessage,
          type: 'error'
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [addToast, domain]);

  // Load domain verification data
  useEffect(() => {
    loadDomainVerification();
  }, [loadDomainVerification]);

  // Start polling when verification is pending
  useEffect(() => {
    if (verification?.verificationStatus === 'pending' && !isPolling) {
      setIsPolling(true);
      senderService.startDomainVerificationPolling(
        domain,
        (updatedVerification, error) => {
          if (error) {
            console.error('Polling error:', error);
            return;
          }

          if (updatedVerification) {
            setVerification(updatedVerification);

            if (updatedVerification.verificationStatus === 'verified') {
              addToast({
                title: 'Domain verified!',
                message: `${domain} has been successfully verified`,
                type: 'success'
              });
              onVerificationComplete?.(updatedVerification);
              setIsPolling(false);
            } else if (updatedVerification.verificationStatus === 'failed') {
              addToast({
                title: 'Domain verification failed',
                message: 'Please check your DNS records and try again',
                type: 'error'
              });
              setIsPolling(false);
            }
          }
        },
        10000 // Poll every 10 seconds
      );
    }

    return () => {
      if (isPolling) {
        senderService.stopVerificationPolling(`domain:${domain}`);
        setIsPolling(false);
      }
    };
  }, [verification?.verificationStatus, domain, isPolling, addToast, onVerificationComplete]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDomainVerification(true);
    setIsRefreshing(false);
  };

  const handleRetryLoad = () => {
    loadDomainVerification(true);
  };

  const handleCopyRecord = async (record: { name: string; type: string; value: string }) => {
    try {
      await navigator.clipboard.writeText(record.value);
      setCopiedRecord(record.name);
      addToast({
        title: 'DNS record copied',
        message: 'DNS record value has been copied to clipboard',
        type: 'success'
      });

      // Reset copied state after 3 seconds
      setTimeout(() => {
        setCopiedRecord(null);
      }, 3000);
    } catch {
      addToast({
        title: 'Failed to copy',
        message: 'Could not copy to clipboard. Please copy manually.',
        type: 'error'
      });
    }
  };

  const getStatusIcon = (status: DomainVerification['verificationStatus']) => {
    switch (status) {
      case 'verified':
        return <CheckCircleIcon className="w-6 h-6 text-success-600" />;
      case 'pending':
        return <ClockIcon className="w-6 h-6 text-warning-600 animate-pulse" />;
      case 'failed':
        return <XCircleIcon className="w-6 h-6 text-error-600" />;
      default:
        return <ClockIcon className="w-6 h-6 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: DomainVerification['verificationStatus']) => {
    switch (status) {
      case 'verified':
        return 'Domain Verified';
      case 'pending':
        return 'Verification Pending';
      case 'failed':
        return 'Verification Failed';
      default:
        return 'Unknown Status';
    }
  };

  const getStatusBadgeClass = (status: DomainVerification['verificationStatus']) => {
    switch (status) {
      case 'verified':
        return 'bg-success-100 text-success-800 border-success-200';
      case 'pending':
        return 'bg-warning-100 text-warning-800 border-warning-200';
      case 'failed':
        return 'bg-error-100 text-error-800 border-error-200';
      default:
        return 'bg-muted text-foreground border-border';
    }
  };

  if (isLoading && !verification) {
    return (
      <LoadingOverlay
        isLoading={true}
        message="Loading domain verification..."
        className={className}
      >
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-muted rounded-full animate-pulse"></div>
              <div className="space-y-2 flex-1">
                <div className="w-48 h-4 bg-muted rounded animate-pulse"></div>
                <div className="w-32 h-3 bg-muted rounded animate-pulse"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="w-full h-4 bg-muted rounded animate-pulse"></div>
              <div className="w-3/4 h-4 bg-muted rounded animate-pulse"></div>
              <div className="w-1/2 h-4 bg-muted rounded animate-pulse"></div>
            </div>
          </div>
        </Card>
      </LoadingOverlay>
    );
  }

  if (loadError && !verification) {
    const errorInfo = parseApiError({ error: loadError });

    if (errorInfo.type === 'network') {
      return (
        <NetworkError
          onRetry={handleRetryLoad}
          className={className}
        />
      );
    }

    return (
      <ErrorDisplay
        title="Unable to load domain verification"
        message={`Could not retrieve verification information for ${domain}: ${loadError}`}
        severity="error"
        retryable={errorInfo.retryable}
        onRetry={handleRetryLoad}
        suggestions={[
          'Check your internet connection',
          'Verify the domain name is correct',
          'Try refreshing the page',
          'Contact support if the problem persists'
        ]}
        className={className}
      />
    );
  }

  return (
    <Card className={cn('p-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <GlobeAltIcon className="w-8 h-8 text-primary-600" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Domain Verification
            </h3>
            <p className="text-sm text-muted-foreground">{domain}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className={cn(
            'px-3 py-1 rounded-full text-sm font-medium border flex items-center space-x-2',
            getStatusBadgeClass(verification?.verificationStatus || 'pending')
          )}>
            {getStatusIcon(verification?.verificationStatus || 'pending')}
            <span>{getStatusText(verification?.verificationStatus || 'pending')}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            isLoading={isRefreshing}
          >
            <ArrowPathIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Status-specific content */}
      {verification?.verificationStatus === 'verified' && (
        <div className="bg-success-50 border border-success-200 rounded-md p-4 mb-6">
          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="w-5 h-5 text-success-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-success-800 mb-1">
                Domain Successfully Verified
              </h4>
              <p className="text-sm text-success-700">
                Your domain {domain} has been verified. You can now send emails from any address under this domain.
              </p>
            </div>
          </div>
        </div>
      )}

      {verification?.verificationStatus === 'failed' && (
        <div className="bg-error-50 border border-error-200 rounded-md p-4 mb-6">
          <div className="flex items-start space-x-3">
            <XCircleIcon className="w-5 h-5 text-error-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-error-800 mb-1">
                Domain Verification Failed
              </h4>
              <p className="text-sm text-error-700 mb-2">
                We couldn&apos;t verify your domain. Please check that the DNS records are correctly configured.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                isLoading={isRefreshing}
              >
                Retry Verification
              </Button>
            </div>
          </div>
        </div>
      )}

      {verification?.verificationStatus === 'pending' && (
        <div className="bg-warning-50 border border-warning-200 rounded-md p-4 mb-6">
          <div className="flex items-start space-x-3">
            <ClockIcon className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5 animate-pulse" />
            <div>
              <h4 className="text-sm font-medium text-warning-800 mb-1">
                Verification in Progress
              </h4>
              <p className="text-sm text-warning-700">
                We&apos;re checking your DNS records. This can take up to 72 hours to complete.
                We&apos;ll automatically update the status when verification is complete.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* DNS Records Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-md font-medium text-foreground">DNS Records</h4>
          <div className="text-sm text-muted-foreground">
            {verification?.dnsRecords?.length || 0} record{(verification?.dnsRecords?.length || 0) !== 1 ? 's' : ''} required
          </div>
        </div>

        <div className="space-y-3">
          {verification?.dnsRecords?.map((record, index) => (
            <div
              key={index}
              className="border border-border rounded-lg p-4 bg-background"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-foreground">
                    Record {index + 1}
                  </span>
                  <span className="px-2 py-1 bg-primary-100 text-primary-800 text-xs rounded">
                    {record.type}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyRecord(record)}
                  className={copiedRecord === record.name ? 'border-success-300 bg-success-50' : ''}
                >
                  {copiedRecord === record.name ? (
                    <>
                      <CheckIcon className="w-4 h-4 mr-1 text-success-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
                      Copy Value
                    </>
                  )}
                </Button>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <div className="block text-xs font-medium text-muted-foreground mb-1">
                    Name/Host
                  </div>
                  <code className="block bg-surface px-3 py-2 rounded border text-foreground font-mono text-xs break-all">
                    {record.name}
                  </code>
                </div>

                <div>
                  <div className="block text-xs font-medium text-muted-foreground mb-1">
                    Value
                  </div>
                  <code className="block bg-surface px-3 py-2 rounded border text-foreground font-mono text-xs break-all">
                    {record.value}
                  </code>
                </div>

                {record.description && (
                  <div className="text-xs text-muted-foreground mt-2">
                    <InformationCircleIcon className="w-3 h-3 inline mr-1" />
                    {record.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-6 bg-primary-50 border border-primary-200 rounded-md p-4">
        <h4 className="text-sm font-medium text-primary-900 mb-3">
          Setup Instructions
        </h4>
        <div className="space-y-2 text-sm text-primary-800">
          {verification?.instructions?.map((instruction, index) => (
            <div key={index} className="flex items-start space-x-2">
              <span className="flex-shrink-0 w-5 h-5 bg-primary-200 text-primary-800 rounded-full text-xs flex items-center justify-center font-medium mt-0.5">
                {index + 1}
              </span>
              <p>{instruction}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Important Notes */}
      <div className="mt-4 bg-warning-50 border border-warning-200 rounded-md p-4">
        <div className="flex items-start space-x-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <h4 className="font-medium text-warning-900 mb-2">Important Notes</h4>
            <ul className="text-warning-800 space-y-1 list-disc list-inside">
              <li>DNS changes can take up to 72 hours to propagate globally</li>
              <li>Make sure to add the records exactly as shown above</li>
              <li>Some DNS providers may require you to omit the domain name from the record name</li>
              <li>Contact your DNS provider if you need help adding these records</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Actions */}
      {onClose && (
        <div className="flex justify-end mt-6 pt-4 border-t border-border">
          <Button
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      )}
    </Card>
  );
};
