import React from 'react';
import { Users, Mail, AlertTriangle, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import {
  calculateUsagePercentage,
  getUsageStatus,
  formatUsage
} from '@/constants';
import type { UsageDisplayProps } from '@/types';

interface UsageProgressBarProps {
  current: number;
  limit: number;
  label: string;
  icon: React.ReactNode;
  resetDate?: string;
}

function UsageProgressBar({ current, limit, label, icon, resetDate }: UsageProgressBarProps) {
  const percentage = calculateUsagePercentage(current, limit);
  const status = getUsageStatus(percentage);

  const getBarColor = () => {
    switch (status) {
      case 'blocked': return 'bg-error-500';
      case 'critical': return 'bg-error-400';
      case 'warning': return 'bg-warning-400';
      default: return 'bg-primary-500';
    }
  };

  const getTextColor = () => {
    switch (status) {
      case 'blocked': return 'text-error-700';
      case 'critical': return 'text-error-600';
      case 'warning': return 'text-warning-700';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>
        <span className={`text-sm font-medium ${getTextColor()}`}>
          {formatUsage(current, limit)} ({percentage}%)
        </span>
      </div>

      <div className="w-full bg-muted rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${getBarColor()}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      {resetDate && (
        <p className="text-xs text-muted-foreground">
          Resets on {new Date(resetDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          })}
        </p>
      )}

      {status === 'warning' && (
        <div className="flex items-center gap-1 text-warning-700">
          <AlertTriangle className="w-3 h-3" />
          <span className="text-xs">Approaching limit</span>
        </div>
      )}

      {status === 'critical' && (
        <div className="flex items-center gap-1 text-error-700">
          <AlertTriangle className="w-3 h-3" />
          <span className="text-xs">Near limit - consider upgrading</span>
        </div>
      )}

      {status === 'blocked' && (
        <div className="flex items-center gap-1 text-error-700">
          <AlertTriangle className="w-3 h-3" />
          <span className="text-xs font-medium">Limit reached</span>
        </div>
      )}
    </div>
  );
}

export function UsageDisplay({
  usage,
  plan,
  showUpgradePrompt = true,
  onUpgrade
}: UsageDisplayProps) {
  const subscribersStatus = getUsageStatus(usage.subscribers.percentage);
  const emailsStatus = getUsageStatus(usage.monthlyEmails.percentage);
  const shouldShowUpgrade = showUpgradePrompt &&
    (subscribersStatus === 'warning' || subscribersStatus === 'critical' || subscribersStatus === 'blocked' ||
     emailsStatus === 'warning' || emailsStatus === 'critical' || emailsStatus === 'blocked');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Usage & Limits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Subscribers Usage */}
        <UsageProgressBar
          current={usage.subscribers.current}
          limit={usage.subscribers.limit}
          label="Subscribers"
          icon={<Users className="w-4 h-4 text-muted-foreground" />}
        />

        {/* Monthly Emails Usage */}
        <UsageProgressBar
          current={usage.monthlyEmails.current}
          limit={usage.monthlyEmails.limit}
          label="Monthly Emails"
          icon={<Mail className="w-4 h-4 text-muted-foreground" />}
          resetDate={usage.monthlyEmails.resetDate}
        />

        {/* Plan Features */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-foreground mb-3">Plan Features</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Custom Domain</span>
              <span className={plan.limits.customDomain ? 'text-success-600' : 'text-muted-foreground'}>
                {plan.limits.customDomain ? '&check;' : '&times;'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sponsor Reminders</span>
              <span className={plan.limits.sponsorReminders ? 'text-success-600' : 'text-muted-foreground'}>
                {plan.limits.sponsorReminders ? '&check;' : '&times;'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">API Access</span>
              <span className={plan.limits.apiAccess ? 'text-success-600' : 'text-muted-foreground'}>
                {plan.limits.apiAccess ? '&check;' : '&times;'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Advanced Analytics</span>
              <span className={plan.limits.analytics ? 'text-success-600' : 'text-muted-foreground'}>
                {plan.limits.analytics ? '&check;' : '&times;'}
              </span>
            </div>
          </div>
        </div>

        {/* Upgrade Prompt */}
        {shouldShowUpgrade && onUpgrade && (
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <TrendingUp className="w-5 h-5 text-primary-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-primary-800">
                  Consider Upgrading
                </h4>
                <p className="text-sm text-primary-700 mt-1">
                  You&apos;re approaching your plan limits. Upgrade to get more capacity and additional features.
                </p>
                <Button
                  size="sm"
                  onClick={onUpgrade}
                  className="mt-3"
                >
                  View Plans
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Blocked State */}
        {(subscribersStatus === 'blocked' || emailsStatus === 'blocked') && (
          <div className="bg-error-50 border border-error-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-error-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-error-800">
                  Limit Reached
                </h4>
                <p className="text-sm text-error-700 mt-1">
                  You&apos;ve reached your plan limits.
                  {subscribersStatus === 'blocked' && ' You cannot add more subscribers.'}
                  {emailsStatus === 'blocked' && ' You cannot send more emails this month.'}
                  {' '}Upgrade your plan to continue.
                </p>
                {onUpgrade && (
                  <Button
                    size="sm"
                    onClick={onUpgrade}
                    className="mt-3"
                  >
                    Upgrade Now
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default UsageDisplay;

