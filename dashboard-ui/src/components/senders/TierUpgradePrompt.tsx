import React from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import type { TierLimits } from '@/types';
import {
  SparklesIcon,
  CheckIcon,
  XMarkIcon,
  ArrowUpIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  UserGroupIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';

interface TierUpgradePromptProps {
  currentTier: TierLimits;
  context: 'sender-limit' | 'dns-verification' | 'feature-disabled' | 'general';
  feature?: string;
  onUpgrade?: () => void;
  className?: string;
  variant?: 'card' | 'banner' | 'inline';
  showComparison?: boolean;
}

interface TierFeatures {
  name: string;
  displayName: string;
  price: string;
  maxSenders: number;
  canUseDNS: boolean;
  canUseMailbox: boolean;
  features: string[];
  highlight?: boolean;
  popular?: boolean;
}

const tierFeatures: Record<string, TierFeatures> = {
  'free-tier': {
    name: 'free-tier',
    displayName: 'Free',
    price: '$0/month',
    maxSenders: 1,
    canUseDNS: false,
    canUseMailbox: true,
    features: [
      '1 sender email',
      'Email verification only',
      'Basic neter features',
      'Up to 100 subscribers',
      'Basic analytics'
    ]
  },
  'creator-tier': {
    name: 'creator-tier',
    displayName: 'Creator',
    price: '$19/month',
    maxSenders: 2,
    canUseDNS: true,
    canUseMailbox: true,
    features: [
      '2 sender emails',
      'Email & domain verification',
      'Advanced newsletter features',
      'Up to 1,000 subscribers',
      'Advanced analytics',
      'Custom branding',
      'Priority support'
    ],
    popular: true
  },
  'pro-tier': {
    name: 'pro-tier',
    displayName: 'Pro',
    price: '$49/month',
    maxSenders: 5,
    canUseDNS: true,
    canUseMailbox: true,
    features: [
      '5 sender emails',
      'Email & domain verification',
      'All newsletter features',
      'Unlimited subscribers',
      'Advanced analytics & insights',
      'Full white-label branding',
      'API access',
      'Priority support',
      'Custom integrations'
    ],
    highlight: true
  }
};

export const TierUpgradePrompt: React.FC<TierUpgradePromptProps> = ({
  currentTier,
  context,
  feature,
  onUpgrade,
  className,
  variant = 'card',
  showComparison = false
}) => {
  const { addToast } = useToast();

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      // TODO: Implement actual upgrade flow
      addToast({
        title: 'Upgrade coming soon',
        message: 'Plan upgrade functionality will be available soon',
        type: 'info'
      });
    }
  };

  const getContextMessage = () => {
    switch (context) {
      case 'sender-limit':
        return {
          title: 'Sender limit reached',
          description: `You've reached the maximum of ${currentTier.maxSenders} sender email${currentTier.maxSenders !== 1 ? 's' : ''} for your ${currentTier.tier.replace('-', ' ')} plan.`,
          icon: <EnvelopeIcon className="w-6 h-6" />,
          color: 'amber'
        };
      case 'dns-verification':
        return {
          title: 'Domain verification unavailable',
          description: 'Domain verification is available on Creator and Pro plans. Upgrade to verify entire domains and send from any email address.',
          icon: <GlobeAltIcon className="w-6 h-6" />,
          color: 'blue'
        };
      case 'feature-disabled':
        return {
          title: `${feature || 'Feature'} unavailable`,
          description: `This feature is not available on your current ${currentTier.tier.replace('-', ' ')} plan. Upgrade to unlock more capabilities.`,
          icon: <SparklesIcon className="w-6 h-6" />,
          color: 'purple'
        };
      default:
        return {
          title: 'Unlock more features',
          description: 'Upgrade your plan to access more sender emails, domain verification, and advanced features.',
          icon: <ArrowUpIcon className="w-6 h-6" />,
          color: 'blue'
        };
    }
  };

  const getNextTier = (): TierFeatures | null => {
    if (currentTier.tier === 'free-tier') {
      return tierFeatures['creator-tier'];
    } else if (currentTier.tier === 'creator-tier') {
      return tierFeatures['pro-tier'];
    }
    return null;
  };

  const getColorClasses = (color: string) => {
    const colors = {
      amber: {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        icon: 'text-amber-600',
        title: 'text-amber-900',
        text: 'text-amber-800',
        button: 'bg-amber-600 hover:bg-amber-700 text-white'
      },
      blue: {
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: 'text-blue-600',
        title: 'text-blue-900',
        text: 'text-blue-800',
        button: 'bg-blue-600 hover:bg-blue-700 text-white'
      },
      purple: {
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        icon: 'text-purple-600',
        title: 'text-purple-900',
        text: 'text-purple-800',
        button: 'bg-purple-600 hover:bg-purple-700 text-white'
      }
    };
    return colors[color as keyof typeof colors] || colors.blue;
  };

  const contextMessage = getContextMessage();
  const nextTier = getNextTier();
  const colorClasses = getColorClasses(contextMessage.color);

  if (variant === 'banner') {
    return (
      <div className={cn(
        'rounded-lg p-4 border',
        colorClasses.bg,
        colorClasses.border,
        className
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={colorClasses.icon}>
              {contextMessage.icon}
            </div>
            <div>
              <h4 className={cn('font-medium', colorClasses.title)}>
                {contextMessage.title}
              </h4>
              <p className={cn('text-sm', colorClasses.text)}>
                {contextMessage.description}
              </p>
            </div>
          </div>
          <Button
            onClick={handleUpgrade}
            size="sm"
            className={colorClasses.button}
          >
            Upgrade Plan
          </Button>
        </div>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center justify-between p-3 rounded-md border', colorClasses.bg, colorClasses.border, className)}>
        <div className="flex items-center space-x-2">
          <div className={cn('w-4 h-4', colorClasses.icon)}>
            {contextMessage.icon}
          </div>
          <span className={cn('text-sm font-medium', colorClasses.title)}>
            {nextTier ? `Upgrade to ${nextTier.displayName}` : 'Upgrade Plan'}
          </span>
        </div>
        <Button
          onClick={handleUpgrade}
          size="sm"
          variant="outline"
        >
          Upgrade
        </Button>
      </div>
    );
  }

  // Card variant (default)
  return (
    <Card className={cn('p-6', className)}>
      <div className="text-center">
        <div className={cn('w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-4', colorClasses.bg)}>
          <div className={colorClasses.icon}>
            {contextMessage.icon}
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {contextMessage.title}
        </h3>

        <p className="text-gray-600 mb-6">
          {contextMessage.description}
        </p>

        {nextTier && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-center space-x-2 mb-3">
              <SparklesIcon className="w-5 h-5 text-blue-600" />
              <h4 className="font-semibold text-blue-900">
                Upgrade to {nextTier.displayName}
              </h4>
              {nextTier.popular && (
                <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                  Popular
                </span>
              )}
            </div>

            <div className="text-center mb-4">
              <span className="text-2xl font-bold text-gray-900">{nextTier.price}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <CheckIcon className="w-4 h-4 text-green-600" />
                  <span>{nextTier.maxSenders} sender email{nextTier.maxSenders !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center space-x-2">
                  {nextTier.canUseDNS ? (
                    <CheckIcon className="w-4 h-4 text-green-600" />
                  ) : (
                    <XMarkIcon className="w-4 h-4 text-gray-400" />
                  )}
                  <span className={nextTier.canUseDNS ? '' : 'text-gray-500'}>
                    Domain verification
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {nextTier.canUseMailbox ? (
                    <CheckIcon className="w-4 h-4 text-green-600" />
                  ) : (
                    <XMarkIcon className="w-4 h-4 text-gray-400" />
                  )}
                  <span className={nextTier.canUseMailbox ? '' : 'text-gray-500'}>
                    Email verification
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {nextTier.features.slice(3, 6).map((feature, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <CheckIcon className="w-4 h-4 text-green-600" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <Button
          onClick={handleUpgrade}
          size="lg"
          className="w-full mb-4"
        >
          <ArrowUpIcon className="w-4 h-4 mr-2" />
          {nextTier ? `Upgrade to ${nextTier.displayName}` : 'Upgrade Plan'}
        </Button>

        <p className="text-xs text-gray-500">
          Upgrade anytime • Cancel anytime • 30-day money-back guarantee
        </p>
      </div>

      {showComparison && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h4 className="text-md font-semibold text-gray-900 mb-4 text-center">
            Compare Plans
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.values(tierFeatures).map((tier) => (
              <div
                key={tier.name}
                className={cn(
                  'border rounded-lg p-4 relative',
                  tier.name === currentTier.tier
                    ? 'border-blue-500 bg-blue-50'
                    : tier.highlight
                    ? 'border-purple-300 bg-purple-50'
                    : 'border-gray-200'
                )}
              >
                {tier.name === currentTier.tier && (
                  <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                      Current Plan
                    </span>
                  </div>
                )}

                {tier.popular && tier.name !== currentTier.tier && (
                  <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                    <span className="bg-green-600 text-white text-xs px-2 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="text-center mb-4">
                  <h5 className="font-semibold text-gray-900 mb-1">{tier.displayName}</h5>
                  <p className="text-lg font-bold text-gray-900">{tier.price}</p>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Sender emails</span>
                    <span className="font-medium">{tier.maxSenders}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Domain verification</span>
                    {tier.canUseDNS ? (
                      <CheckIcon className="w-4 h-4 text-green-600" />
                    ) : (
                      <XMarkIcon className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Email verification</span>
                    {tier.canUseMailbox ? (
                      <CheckIcon className="w-4 h-4 text-green-600" />
                    ) : (
                      <XMarkIcon className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                </div>

                {tier.name !== currentTier.tier && (
                  <Button
                    onClick={handleUpgrade}
                    variant={tier.highlight ? 'primary' : 'outline'}
                    size="sm"
                    className="w-full mt-4"
                  >
                    {tier.name === 'free-tier' ? 'Downgrade' : 'Upgrade'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
