import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ErrorDisplay, ValidationErrorSummary } from '@/components/ui/ErrorDisplay';
import { LoadingOverlay, InlineLoading } from '@/components/ui/LoadingStates';
import { senderService } from '@/services/senderService';
import { createSenderSchema, verificationTypeOptions, extractDomainFromEmail } from '@/schemas/senderSchema';
import { getUserFriendlyErrorMessage, parseApiError } from '@/utils/errorHandling';
import type { TierLimits, SenderEmail } from '@/types';
import type { CreateSenderFormData } from '@/schemas/senderSchema';
import {
  EnvelopeIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

interface AddSenderFormProps {
  tierLimits: TierLimits;
  existingSenders: SenderEmail[];
  onSenderCreated: (sender: SenderEmail) => void;
  onCancel?: () => void;
  onUpgrade?: () => void;
  className?: string;
}

export const AddSenderForm: React.FC<AddSenderFormProps> = ({
  tierLimits,
  existingSenders,
  onSenderCreated,
  onCancel,
  onUpgrade,
  className
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedVerificationType, setSelectedVerificationType] = useState<'mailbox' | 'domain' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { addToast } = useToast();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset
  } = useForm<CreateSenderFormData>({
    resolver: zodResolver(createSenderSchema),
    defaultValues: {
      email: '',
      name: '',
      verificationType: undefined
    }
  });

  const watchedEmail = watch('email');
  const watchedVerificationType = watch('verificationType');

  // Update selected verification type when form value changes
  useEffect(() => {
    setSelectedVerificationType(watchedVerificationType || null);
  }, [watchedVerificationType]);

  // Auto-suggest domain verification if email domain is already verified
  useEffect(() => {
    if (watchedEmail && selectedVerificationType === null) {
      const domain = extractDomainFromEmail(watchedEmail);
      if (domain) {
        const domainAlreadyVerified = existingSenders.some(
          sender => sender.domain === domain && sender.verificationStatus === 'verified'
        );
        if (domainAlreadyVerified && tierLimits.canUseDNS) {
          setValue('verificationType', 'domain');
        }
      }
    }
  }, [watchedEmail, selectedVerificationType, existingSenders, tierLimits.canUseDNS, setValue]);

  const canAddSender = senderService.canAddSender(tierLimits);
  const availableSlots = senderService.getAvailableSlots(tierLimits);

  const getVerificationTypeAvailability = (type: 'mailbox' | 'domain') => {
    if (type === 'mailbox') {
      return {
        available: tierLimits.canUseMailbox,
        reason: !tierLimits.canUseMailbox ? 'Not available on your current plan' : null
      };
    } else {
      return {
        available: tierLimits.canUseDNS,
        reason: !tierLimits.canUseDNS ? 'Upgrade to Creator tier or higher to use domain verification' : null
      };
    }
  };

  const validateEmailUniqueness = (email: string): string | null => {
    const existingEmail = existingSenders.find(sender =>
      sender.email.toLowerCase() === email.toLowerCase()
    );
    if (existingEmail) {
      return 'This email address is already configured';
    }
    return null;
  };

  const handleFormSubmit = async (data: CreateSenderFormData) => {
    // Prevent multiple submissions
    if (isSubmitting) {
      return;
    }

    // Clear previous errors
    setSubmitError(null);

    if (!canAddSender) {
      const errorMessage = `You've reached the maximum of ${tierLimits.maxSenders} sender emails for your ${tierLimits.tier.replace('-', ' ')} plan`;
      setSubmitError(errorMessage);
      addToast({
        title: 'Sender limit reached',
        message: errorMessage,
        type: 'error'
      });
      return;
    }

    const emailError = validateEmailUniqueness(data.email);
    if (emailError) {
      setSubmitError(emailError);
      addToast({
        title: 'Email already exists',
        message: emailError,
        type: 'error'
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await senderService.createSenderWithRetry(data);

      if (response.success && response.data) {
        addToast({
          title: 'Sender email added',
          message: `${data.email} has been added successfully. ${
            data.verificationType === 'mailbox'
              ? 'Check your email for a verification link.'
              : 'Complete domain verification to start sending.'
          }`,
          type: 'success'
        });
        onSenderCreated(response.data);
        reset();
        setSelectedVerificationType(null);
        setRetryCount(0);
      } else {
        const errorInfo = parseApiError(response);
        const userFriendlyMessage = getUserFriendlyErrorMessage(response, 'sender');

        setSubmitError(userFriendlyMessage);

        // Show different toast based on error type
        if (errorInfo.retryable) {
          addToast({
            title: 'Failed to add sender',
            message: `${userFriendlyMessage} You can try again.`,
            type: 'error'
          });
        } else {
          addToast({
            title: 'Unable to add sender',
            message: userFriendlyMessage,
            type: 'error'
          });
        }
      }
    } catch (error) {
      const userFriendlyMessage = getUserFriendlyErrorMessage(error, 'sender');
      setSubmitError(userFriendlyMessage);

      addToast({
        title: 'Failed to add sender',
        message: userFriendlyMessage,
        type: 'error'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    setSubmitError(null);
    handleSubmit(handleFormSubmit)();
  };

  const handleVerificationTypeSelect = (type: 'mailbox' | 'domain') => {
    const availability = getVerificationTypeAvailability(type);
    if (availability.available) {
      setValue('verificationType', type);
      setSelectedVerificationType(type);
    }
  };

  if (!canAddSender) {
    return (
      <Card className={cn('p-6 border-warning-200 bg-warning-50', className)}>
        <div className="flex items-start space-x-3">
          <ExclamationTriangleIcon className="w-6 h-6 text-warning-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-medium text-warning-900 mb-2">
              Sender limit reached
            </h3>
            <p className="text-warning-800 mb-4">
              You&apos;ve reached the maximum of {tierLimits.maxSenders} sender email{tierLimits.maxSenders !== 1 ? 's' : ''}
              for your {tierLimits.tier.replace('-', ' ')} plan.
            </p>
            <div className="space-y-2 text-sm text-warning-700">
              <p><strong>Current plan limits:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>{tierLimits.maxSenders} sender email{tierLimits.maxSenders !== 1 ? 's' : ''}</li>
                <li>{tierLimits.canUseMailbox ? 'Email verification' : 'No email verification'}</li>
                <li>{tierLimits.canUseDNS ? 'Domain verification' : 'No domain verification'}</li>
              </ul>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => {
                if (onUpgrade) {
                  onUpgrade();
                } else {
                  // Fallback to coming soon message
                  addToast({
                    title: 'Upgrade coming soon',
                    message: 'Plan upgrade functionality will be available soon',
                    type: 'info'
                  });
                }
              }}
            >
              Upgrade Plan
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <LoadingOverlay
      isLoading={isSubmitting}
      message="Adding sender email..."
      className={className}
    >
      <Card className="p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-2">Add Sender Email</h3>
          <p className="text-sm text-muted-foreground">
            Add a new email address to send newsletters from. You have {availableSlots} of {tierLimits.maxSenders} slots available.
          </p>
        </div>

        {/* Error Display */}
        {submitError && (
          <div className="mb-6">
            <ErrorDisplay
              title="Unable to add sender"
              message={submitError}
              severity="error"
              retryable={parseApiError({ error: submitError }).retryable}
              onRetry={handleRetry}
              compact={true}
            />
          </div>
        )}

        {/* Validation Error Summary */}
        {Object.keys(errors).length > 0 && (
          <div className="mb-6">
            <ValidationErrorSummary
              errors={Object.fromEntries(
                Object.entries(errors).map(([key, error]) => [key, error?.message || 'Invalid value'])
              )}
            />
          </div>
        )}

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
        {/* Email Input */}
        <div>
          <Input
            label="Email Address"
            {...register('email')}
            error={errors.email?.message}
            disabled={isSubmitting}
            placeholder="newsletter@yourdomain.com"
            type="email"
            required
          />
          {watchedEmail && validateEmailUniqueness(watchedEmail) && (
            <p className="mt-1 text-sm text-error-600 flex items-center">
              <XCircleIcon className="w-4 h-4 mr-1" />
              {validateEmailUniqueness(watchedEmail)}
            </p>
          )}
        </div>

        {/* Sender Name Input */}
        <div>
          <Input
            label="Sender Name (Optional)"
            {...register('name')}
            error={errors.name?.message}
            disabled={isSubmitting}
            placeholder="Your Newsletter"
            helperText="This name will appear in the &quot;From&quot; field of your emails"
          />
        </div>

        {/* Verification Type Selection */}
        <div>
          <div className="block text-sm font-medium text-muted-foreground mb-3">
            Verification Method <span className="text-error-500">*</span>
          </div>

          <div className="space-y-3">
            {verificationTypeOptions.map((option) => {
              const availability = getVerificationTypeAvailability(option.value);
              const isSelected = selectedVerificationType === option.value;
              const isDisabled = !availability.available || isSubmitting;

              return (
                <button
                  key={option.value}
                  className={cn(
                    'border rounded-lg p-4 text-left transition-all duration-200 w-full',
                    isSelected && availability.available
                      ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                      : availability.available
                      ? 'border-border hover:border-border hover:bg-background'
                      : 'border-border bg-background cursor-not-allowed opacity-60'
                  )}
                  type="button"
                  onClick={() => handleVerificationTypeSelect(option.value)}
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-1">
                      {option.value === 'mailbox' ? (
                        <EnvelopeIcon className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <GlobeAltIcon className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h4 className="text-sm font-medium text-foreground">
                          {option.label}
                        </h4>
                        {isSelected && availability.available && (
                          <CheckCircleIcon className="w-4 h-4 text-primary-600" data-testid="check-circle-icon" />
                        )}
                        {!availability.available && (
                          <XCircleIcon className="w-4 h-4 text-error-500" />
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground mb-2">
                        {option.description}
                      </p>

                      {!availability.available && availability.reason && (
                        <div className="flex items-center space-x-1 text-xs text-error-600 mb-2">
                          <InformationCircleIcon className="w-3 h-3" />
                          <span>{availability.reason}</span>
                        </div>
                      )}

                      {availability.available && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="font-medium text-success-700 mb-1">Pros:</p>
                            <ul className="text-success-600 space-y-0.5">
                              {option.pros.map((pro, index) => (
                                <li key={index}>- {pro}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="font-medium text-warning-700 mb-1">Considerations:</p>
                            <ul className="text-warning-600 space-y-0.5">
                              {option.cons.map((con, index) => (
                                <li key={index}>- {con}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {errors.verificationType && (
            <p className="mt-2 text-sm text-error-600 flex items-center">
              <XCircleIcon className="w-4 h-4 mr-1" />
              {errors.verificationType.message}
            </p>
          )}
        </div>

        {/* Domain Suggestion */}
        {watchedEmail && selectedVerificationType === 'domain' && (
          <div className="bg-primary-50 border border-primary-200 rounded-md p-4">
            <div className="flex items-start space-x-2">
              <InformationCircleIcon className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-primary-800 font-medium mb-1">Domain Verification</p>
                <p className="text-primary-700">
                  You&apos;ll verify the domain &quot;{extractDomainFromEmail(watchedEmail)}&quot; which will allow you to send
                  from any email address under this domain.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-border">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            disabled={isSubmitting || !selectedVerificationType}
            isLoading={isSubmitting}
          >
            <InlineLoading
              isLoading={isSubmitting}
              loadingText="Adding..."
            >
              {retryCount > 0 ? 'Try Again' : 'Add Sender Email'}
            </InlineLoading>
          </Button>
        </div>
      </form>
    </Card>
    </LoadingOverlay>
  );
};

