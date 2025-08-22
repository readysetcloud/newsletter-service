import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ErrorDisplay, NetworkError } from '@/components/ui/ErrorDisplay';
import { LoadingOverlay, LoadingSpinner } from '@/components/ui/LoadingStates';
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
  const [retryCount, setRetryCount] = useState(0);
  const { addToast } = useToast();

  // Load domain verification data
  useEffect(() => {
    loadDomainVerification();
  }, [domain]);

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

  const loadDomainVerification = async (showToast = false) => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await senderService.getDomainVerificationWithRetry(domain);
      if (response.success && response.data) {
        setVerification(response.data);
        setRetryCount(0);

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
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDomainVerification(true);
    setIsRefreshing(false);
  };

  const handleRetryLoad = () => {
    setRetryCount(prev => prev + 1);
    loadDomainVerification(true);
  };

  const handleCopyRecord = async (record: { name: string; type: string; value: string }) => {
    const recordText = `${record.name} ${record.type} ${record.value}`;
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
    } catch (error) {
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
        return <CheckCircleIcon className="w-6 h-6 text-green-600" />;
      case 'pending':
        return <ClockIcon className="w-6 h-6 text-yellow-600 animate-pulse" />;
      case 'failed':
        return <XCircleIcon className="w-6 h-6 text-red-600" />;
      default:
        return <ClockIcon className="w-6 h-6 text-gray-400" />;
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
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
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
              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
              <div className="space-y-2 flex-1">
                <div className="w-48 h-4 bg-gray-200 rounded animate-pulse"></div>
                <div className="w-32 h-3 bg-gray-200 rounded animate-pulse"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="w-full h-4 bg-gray-200 rounded animate-pulse"></div>
              <div className="w-3/4 h-4 bg-gray-200 rounded animate-pulse"></div>
              <div className="w-1/2 h-4 bg-gray-200 rounded animate-pulse"></div>
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
          <GlobeAltIcon className="w-8 h-8 text-blue-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Domain Verification
            </h3>
            <p className="text-sm text-gray-600">{domain}</p>
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
        <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-6">
          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-green-800 mb-1">
                Domain Successfully Verified
              </h4>
              <p className="text-sm text-green-700">
                Your domain {domain} has been verified. You can now send emails from any address under this domain.
              </p>
            </div>
          </div>
        </div>
      )}

      {verification?.verificationStatus === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <div className="flex items-start space-x-3">
            <XCircleIcon className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-red-800 mb-1">
                Domain Verification Failed
              </h4>
              <p className="text-sm text-red-700 mb-2">
                We couldn't verify your domain. Please check that the DNS records are correctly configured.
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
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
          <div className="flex items-start space-x-3">
            <ClockIcon className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5 animate-pulse" />
            <div>
              <h4 className="text-sm font-medium text-yellow-800 mb-1">
                Verification in Progress
              </h4>
              <p className="text-sm text-yellow-700">
                We're checking your DNS records. This can take up to 72 hours to complete.
                We'll automatically update the status when verification is complete.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* DNS Records Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-md font-medium text-gray-900">DNS Records</h4>
          <div className="text-sm text-gray-500">
            {verification?.dnsRecords?.length || 0} record{(verification?.dnsRecords?.length || 0) !== 1 ? 's' : ''} required
          </div>
        </div>

        <div className="space-y-3">
          {verification?.dnsRecords?.map((record, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg p-4 bg-gray-50"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-900">
                    Record {index + 1}
                  </span>
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                    {record.type}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyRecord(record)}
                  className={copiedRecord === record.name ? 'border-green-300 bg-green-50' : ''}
                >
                  {copiedRecord === record.name ? (
                    <>
                      <CheckIcon className="w-4 h-4 mr-1 text-green-600" />
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Name/Host
                  </label>
                  <code className="block bg-white px-3 py-2 rounded border text-gray-900 font-mono text-xs break-all">
                    {record.name}
                  </code>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Value
                  </label>
                  <code className="block bg-white px-3 py-2 rounded border text-gray-900 font-mono text-xs break-all">
                    {record.value}
                  </code>
                </div>

                {record.description && (
                  <div className="text-xs text-gray-600 mt-2">
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
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-3">
          Setup Instructions
        </h4>
        <div className="space-y-2 text-sm text-blue-800">
          {verification?.instructions?.map((instruction, index) => (
            <div key={index} className="flex items-start space-x-2">
              <span className="flex-shrink-0 w-5 h-5 bg-blue-200 text-blue-800 rounded-full text-xs flex items-center justify-center font-medium mt-0.5">
                {index + 1}
              </span>
              <p>{instruction}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Important Notes */}
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-4">
        <div className="flex items-start space-x-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <h4 className="font-medium text-amber-900 mb-2">Important Notes</h4>
            <ul className="text-amber-800 space-y-1 list-disc list-inside">
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
        <div className="flex justify-end mt-6 pt-4 border-t border-gray-200">
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
