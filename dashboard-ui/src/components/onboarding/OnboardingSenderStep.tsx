import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { AddSenderForm, SenderEmailList, type SenderEmail, type TierLimits } from '@/components/senders';
import { senderService } from '@/services/senderService';
import {
  EnvelopeIcon,
  ArrowRightIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

interface OnboardingSenderStepProps {
  onComplete: () => void;
  onSkip: () => void;
  className?: string;
}

export const OnboardingSenderStep: React.FC<OnboardingSenderStepProps> = ({
  onComplete,
  onSkip,
  className
}) => {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [senders, setSenders] = useState<SenderEmail[]>([]);
  const [tierLimits, setTierLimits] = useState<TierLimits>({
    tier: 'free-tier',
    maxSenders: 1,
    currentCount: 0,
    canUseDNS: false,
    canUseMailbox: true
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load sender data on component mount
  useEffect(() => {
    loadSenders();
  }, []);

  const loadSenders = async () => {
    try {
      setIsLoading(true);
      const response = await senderService.getSenders();

      if (response.success && response.data) {
        setSenders(response.data.senders);
        setTierLimits(response.data.tierLimits);
      } else {
        console.error('Failed to load senders:', response.error);
        // Don't show error toast in onboarding, just continue
      }
    } catch (error) {
      console.error('Error loading senders:', error);
      // Don't show error toast in onboarding, just continue
    } finally {
      setIsLoading(false);
    }
  };

  const handleSenderCreated = (sender: SenderEmail) => {
    setSenders(prev => [...prev, sender]);
    setTierLimits(prev => ({
      ...prev,
      currentCount: prev.currentCount + 1
    }));
    setShowAddForm(false);

    addToast({
      type: 'success',
      title: 'Sender Email Added!',
      message: `${sender.email} has been added. ${
        sender.verificationType === 'mailbox'
          ? 'Check your email for a verification link.'
          : 'Complete domain verification to start sending.'
      }`,
    });
  };

  const handleSenderUpdated = (updatedSender: SenderEmail) => {
    setSenders(prev => prev.map(s =>
      s.senderId === updatedSender.senderId ? updatedSender : s
    ));
  };

  const handleSenderDeleted = (senderId: string) => {
    setSenders(prev => prev.filter(s => s.senderId !== senderId));
    setTierLimits(prev => ({
      ...prev,
      currentCount: Math.max(0, prev.currentCount - 1)
    }));
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // Small delay to ensure any pending operations complete
      await new Promise(resolve => setTimeout(resolve, 500));
      onComplete();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setIsSubmitting(true);
    try {
      // Small delay for UX
      await new Promise(resolve => setTimeout(resolve, 300));
      onSkip();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoToFullSetup = () => {
    navigate('/senders');
  };

  const hasVerifiedSender = senders.some(sender => sender.verificationStatus === 'verified');
  const canAddSender = senderService.canAddSender(tierLimits);

  if (isLoading) {
    return (
      <Card className={cn('p-8', className)}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading sender configuration...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-primary-100 rounded-full">
            <EnvelopeIcon className="w-8 h-8 text-primary-600" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Set Up Your Sender Email
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Configure a verified email address to send newsletters from your own domain instead of a generic system address.
          This step is optional but recommended for better deliverability and branding.
        </p>
      </div>

      {/* Current Status */}
      {senders.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Your Sender Emails</h3>
            {hasVerifiedSender && (
              <div className="flex items-center space-x-2 text-success-600">
                <CheckCircleIcon className="w-5 h-5" />
                <span className="text-sm font-medium">Ready to send</span>
              </div>
            )}
          </div>

          <SenderEmailList
            senders={senders}
            tierLimits={tierLimits}
            onSenderDeleted={handleSenderDeleted}
            onSenderUpdated={handleSenderUpdated}
            isLoading={false}
          />
        </Card>
      )}

      {/* Add Sender Form */}
      {showAddForm && (
        <AddSenderForm
          tierLimits={tierLimits}
          existingSenders={senders}
          onSenderCreated={handleSenderCreated}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Add Sender Button */}
      {!showAddForm && canAddSender && (
        <Card className="p-6 text-center">
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {senders.length === 0 ? 'Add Your First Sender Email' : 'Add Another Sender Email'}
          </h3>
          <p className="text-muted-foreground mb-4">
            {senders.length === 0
              ? 'Set up a verified email address to send newsletters from your own domain.'
              : `You can add ${tierLimits.maxSenders - tierLimits.currentCount} more sender email${tierLimits.maxSenders - tierLimits.currentCount !== 1 ? 's' : ''} on your ${tierLimits.tier.replace('-', ' ')} plan.`
            }
          </p>
          <Button
            onClick={() => setShowAddForm(true)}
            className="mb-2"
          >
            Add Sender Email
          </Button>
        </Card>
      )}

      {/* Tier Limit Reached */}
      {!canAddSender && senders.length === 0 && (
        <Card className="p-6 text-center border-warning-200 bg-warning-50">
          <h3 className="text-lg font-semibold text-warning-900 mb-2">
            Upgrade to Add Sender Emails
          </h3>
          <p className="text-warning-800 mb-4">
            Your current plan doesn&apos;t include custom sender emails. You can still send newsletters using our system address, or upgrade to use your own email address.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              addToast({
                type: 'info',
                title: 'Upgrade Coming Soon',
                message: 'Plan upgrade functionality will be available soon',
              });
            }}
            className="mb-2"
          >
            Learn About Upgrading
          </Button>
        </Card>
      )}

      {/* Advanced Setup Link */}
      {senders.length > 0 && (
        <Card className="p-4 bg-background">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Need more advanced setup?</p>
              <p className="text-xs text-muted-foreground">Access the full sender management page for domain verification and advanced options.</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGoToFullSetup}
              className="flex items-center space-x-1"
            >
              <span>Full Setup</span>
              <ArrowRightIcon className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between pt-6 border-t border-border">
        <Button
          variant="ghost"
          onClick={handleSkip}
          disabled={isSubmitting}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </Button>

        <div className="flex space-x-3">
          <Button
            variant="outline"
            onClick={handleGoToFullSetup}
            disabled={isSubmitting}
          >
            Go to Full Setup
          </Button>

          <Button
            onClick={handleComplete}
            disabled={isSubmitting}
            isLoading={isSubmitting}
            className="flex items-center space-x-2"
          >
            <span>Complete Setup</span>
            <ArrowRightIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
