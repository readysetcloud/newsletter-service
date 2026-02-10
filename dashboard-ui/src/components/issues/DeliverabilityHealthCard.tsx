import React, { useMemo } from 'react';
import { Shield, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { InfoTooltip } from '../ui/InfoTooltip';
import { formatPercentageValue } from '../../utils/issueDetailUtils';

export interface DeliverabilityHealthCardProps {
  bounceRate: number;
  complaintRate: number;
  bounceReasons?: {
    permanent: number;
    temporary: number;
    suppressed: number;
  };
  complaintDetails?: Array<{
    email: string;
    timestamp: string;
    complaintType: string;
  }>;
}

type HealthStatus = 'excellent' | 'good' | 'warning' | 'critical';

interface HealthConfig {
  status: HealthStatus;
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
}

function calculateDeliverabilityHealth(
  bounceRate: number,
  complaintRate: number
): HealthStatus {
  if (complaintRate > 0.1 || bounceRate > 10) return 'critical';
  if (complaintRate > 0.05 || bounceRate > 5) return 'warning';
  if (bounceRate < 2 && complaintRate < 0.01) return 'excellent';
  return 'good';
}

function getHealthConfig(status: HealthStatus): HealthConfig {
  const configs: Record<HealthStatus, HealthConfig> = {
    excellent: {
      status: 'excellent',
      label: 'Excellent',
      icon: <ShieldCheck className="w-12 h-12" aria-hidden="true" />,
      color: 'text-success-600 dark:text-success-400',
      bgColor: 'bg-success-50 dark:bg-success-950',
      borderColor: 'border-success-200 dark:border-success-800',
    },
    good: {
      status: 'good',
      label: 'Good',
      icon: <Shield className="w-12 h-12" aria-hidden="true" />,
      color: 'text-primary-600 dark:text-primary-400',
      bgColor: 'bg-primary-50 dark:bg-primary-950',
      borderColor: 'border-primary-200 dark:border-primary-800',
    },
    warning: {
      status: 'warning',
      label: 'Warning',
      icon: <ShieldAlert className="w-12 h-12" aria-hidden="true" />,
      color: 'text-warning-600 dark:text-warning-400',
      bgColor: 'bg-warning-50 dark:bg-warning-950',
      borderColor: 'border-warning-200 dark:border-warning-800',
    },
    critical: {
      status: 'critical',
      label: 'Critical',
      icon: <AlertTriangle className="w-12 h-12" aria-hidden="true" />,
      color: 'text-error-600 dark:text-error-400',
      bgColor: 'bg-error-50 dark:bg-error-950',
      borderColor: 'border-error-200 dark:border-error-800',
    },
  };

  return configs[status];
}

interface ProgressBarProps {
  value: number;
  label: string;
  tooltipLabel: string;
  tooltipDescription: string;
}

const ProgressBar: React.FC<ProgressBarProps> = React.memo(({
  value,
  label,
  tooltipLabel,
  tooltipDescription,
}) => {
  const getColorZone = (val: number, isComplaint: boolean): string => {
    if (isComplaint) {
      if (val < 0.01) return 'bg-success-500';
      if (val < 0.1) return 'bg-warning-500';
      return 'bg-error-500';
    } else {
      if (val < 2) return 'bg-success-500';
      if (val < 5) return 'bg-warning-500';
      return 'bg-error-500';
    }
  };

  const isComplaint = useMemo(() => label.toLowerCase().includes('complaint'), [label]);
  const colorClass = useMemo(() => getColorZone(value, isComplaint), [value, isComplaint]);
  const displayValue = useMemo(() => Math.min(value, 100), [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <InfoTooltip label={tooltipLabel} description={tooltipDescription} />
        </div>
        <span className="text-sm font-semibold text-foreground">
          {formatPercentageValue(value, isComplaint ? 2 : 1)}
        </span>
      </div>

      <div className="relative w-full h-3 bg-muted rounded-full overflow-hidden">
        <div className="absolute inset-0 flex">
          {isComplaint ? (
            <>
              <div className="bg-success-200 dark:bg-success-900" style={{ width: '10%' }} />
              <div className="bg-warning-200 dark:bg-warning-900" style={{ width: '9%' }} />
              <div className="bg-error-200 dark:bg-error-900" style={{ width: '81%' }} />
            </>
          ) : (
            <>
              <div className="bg-success-200 dark:bg-success-900" style={{ width: '20%' }} />
              <div className="bg-warning-200 dark:bg-warning-900" style={{ width: '30%' }} />
              <div className="bg-error-200 dark:bg-error-900" style={{ width: '50%' }} />
            </>
          )}
        </div>

        <div
          className={`absolute inset-y-0 left-0 ${colorClass} transition-all duration-300`}
          style={{ width: `${displayValue}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${formatPercentageValue(value, isComplaint ? 2 : 1)}`}
        />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        {isComplaint ? (
          <>
            <span>Good (&lt;0.01%)</span>
            <span>Warning (0.01-0.1%)</span>
            <span>Critical (&gt;0.1%)</span>
          </>
        ) : (
          <>
            <span>Good (&lt;2%)</span>
            <span>Warning (2-5%)</span>
            <span>Critical (&gt;5%)</span>
          </>
        )}
      </div>
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';

export const DeliverabilityHealthCard: React.FC<DeliverabilityHealthCardProps> = React.memo(({
  bounceRate,
  complaintRate,
  bounceReasons,
  complaintDetails,
}) => {
  const overallHealth = useMemo(() =>
    calculateDeliverabilityHealth(bounceRate, complaintRate),
    [bounceRate, complaintRate]
  );

  const healthConfig = useMemo(() =>
    getHealthConfig(overallHealth),
    [overallHealth]
  );

  const showBounceWarning = useMemo(() => bounceRate > 5, [bounceRate]);
  const showComplaintWarning = useMemo(() => complaintRate > 0.1, [complaintRate]);
  const showAnyWarning = useMemo(() =>
    showBounceWarning || showComplaintWarning,
    [showBounceWarning, showComplaintWarning]
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Deliverability Health</CardTitle>
        <CardDescription>
          Monitor your sender reputation and email deliverability metrics
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div
          className={`flex items-center gap-4 p-6 rounded-lg border-2 ${healthConfig.bgColor} ${healthConfig.borderColor}`}
          role="status"
          aria-live="polite"
          aria-label={`Deliverability health status: ${healthConfig.label}`}
        >
          <div className={healthConfig.color} aria-hidden="true">{healthConfig.icon}</div>
          <div>
            <div className={`text-2xl font-bold ${healthConfig.color}`}>
              {healthConfig.label}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {overallHealth === 'excellent' &&
                'Your deliverability metrics are excellent. Keep up the good work!'}
              {overallHealth === 'good' &&
                'Your deliverability metrics are within acceptable ranges.'}
              {overallHealth === 'warning' &&
                'Some metrics need attention to maintain good deliverability.'}
              {overallHealth === 'critical' &&
                'Immediate action required to protect your sender reputation.'}
            </div>
          </div>
        </div>

        {showAnyWarning && (
          <div
            className="bg-error-50 dark:bg-error-950 border-l-4 border-error-500 p-4 rounded"
            role="alert"
            aria-live="assertive"
            aria-labelledby="deliverability-warning-heading"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="w-5 h-5 text-error-600 dark:text-error-400 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="flex-1">
                <h4 id="deliverability-warning-heading" className="font-semibold text-error-900 dark:text-error-100 mb-2">
                  Deliverability Issues Detected
                </h4>
                <div className="text-sm text-error-800 dark:text-error-200 space-y-2">
                  {showBounceWarning && (
                    <p>
                      <strong>High Bounce Rate ({formatPercentageValue(bounceRate, 1)}):</strong>{' '}
                      Your bounce rate exceeds the recommended threshold of 5%. Clean your email
                      list by removing invalid addresses and consider implementing double opt-in
                      for new subscribers.
                    </p>
                  )}
                  {showComplaintWarning && (
                    <p>
                      <strong>
                        High Complaint Rate ({formatPercentageValue(complaintRate, 2)}):
                      </strong>{' '}
                      Your complaint rate exceeds the critical threshold of 0.1%. Review your
                      content, ensure clear unsubscribe options, and verify you have permission to
                      email all recipients. High complaint rates can severely damage your sender
                      reputation.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6" role="group" aria-label="Deliverability metrics">
          <ProgressBar
            value={bounceRate}
            label="Bounce Rate"
            tooltipLabel="Bounce Rate"
            tooltipDescription="Percentage of emails that could not be delivered. Includes both permanent (hard) and temporary (soft) bounces. Keep below 5% to maintain good sender reputation."
          />

          <ProgressBar
            value={complaintRate}
            label="Complaint Rate"
            tooltipLabel="Complaint Rate"
            tooltipDescription="Percentage of recipients who marked your email as spam. This is the most critical metric for sender reputation. Keep below 0.1% to avoid deliverability issues and potential blacklisting."
          />
        </div>

        {(bounceReasons || complaintDetails) && (
          <div className="pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground" role="status">
              {bounceReasons && (
                <>
                  Bounce breakdown: {bounceReasons.permanent} permanent,{' '}
                  {bounceReasons.temporary} temporary, {bounceReasons.suppressed} suppressed.
                </>
              )}
              {bounceReasons && complaintDetails && complaintDetails.length > 0 && ' '}
              {complaintDetails && complaintDetails.length > 0 && (
                <>
                  {complaintDetails.length} complaint{complaintDetails.length !== 1 ? 's' : ''}{' '}
                  received.
                </>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

DeliverabilityHealthCard.displayName = 'DeliverabilityHealthCard';
