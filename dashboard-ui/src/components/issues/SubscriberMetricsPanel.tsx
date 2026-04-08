import React, { useMemo } from 'react';
import { UserMinus, Trash2, ShieldOff, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { InfoTooltip } from '../ui/InfoTooltip';
import { formatNumber } from '../../utils/issueDetailUtils';

export interface SubscriberMetricsPanelProps {
  unsubscribes?: number | null;
  cleaned?: number | null;
  manualRemovals?: number | null;
  subscribers?: number | null;
}

interface MetricItemProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tooltipLabel: string;
  tooltipDescription: string;
  colorClass: string;
}

const MetricItem: React.FC<MetricItemProps> = React.memo(({
  icon,
  label,
  value,
  tooltipLabel,
  tooltipDescription,
  colorClass,
}) => (
  <div className="bg-muted/50 rounded-lg p-3 sm:p-4 border border-border">
    <div className="flex items-start justify-between mb-2">
      <div className="flex items-center gap-2">
        <span className={colorClass} aria-hidden="true">{icon}</span>
        <span className="text-xs sm:text-sm text-muted-foreground font-medium">{label}</span>
      </div>
      <InfoTooltip label={tooltipLabel} description={tooltipDescription} />
    </div>
    <div className="text-xl sm:text-2xl font-bold text-foreground">
      {formatNumber(value)}
    </div>
  </div>
));

MetricItem.displayName = 'MetricItem';

export const SubscriberMetricsPanel: React.FC<SubscriberMetricsPanelProps> = React.memo(({
  unsubscribes,
  cleaned,
  manualRemovals,
  subscribers,
}) => {
  const safeUnsubscribes = unsubscribes ?? 0;
  const safeCleaned = cleaned ?? 0;
  const safeManualRemovals = manualRemovals ?? 0;
  const safeSubscribers = subscribers ?? 0;

  const totalLoss = useMemo(
    () => safeUnsubscribes + safeCleaned + safeManualRemovals,
    [safeUnsubscribes, safeCleaned, safeManualRemovals]
  );

  const lossPercentage = useMemo(() => {
    if (safeSubscribers <= 0) return null;
    return Math.round((totalLoss / safeSubscribers) * 10000) / 100;
  }, [totalLoss, safeSubscribers]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Subscriber Loss</CardTitle>
          {lossPercentage !== null && (
            <span className="text-sm text-muted-foreground">
              {formatNumber(totalLoss)} lost of {formatNumber(safeSubscribers)} sent — {lossPercentage.toFixed(2)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4"
          role="region"
          aria-label="Subscriber loss metrics"
        >
          <MetricItem
            icon={<UserMinus className="w-4 h-4" />}
            label="Unsubscribes"
            value={safeUnsubscribes}
            tooltipLabel="Unsubscribes"
            tooltipDescription="Subscribers who opted out via the unsubscribe link after this issue."
            colorClass="text-warning-600 dark:text-warning-400"
          />
          <MetricItem
            icon={<ShieldOff className="w-4 h-4" />}
            label="Cleaned"
            value={safeCleaned}
            tooltipLabel="Cleaned"
            tooltipDescription="Subscribers automatically removed due to persistent bounce failures."
            colorClass="text-error-600 dark:text-error-400"
          />
          <MetricItem
            icon={<Trash2 className="w-4 h-4" />}
            label="Manual Removals"
            value={safeManualRemovals}
            tooltipLabel="Manual Removals"
            tooltipDescription="Subscribers manually deleted by the newsletter operator."
            colorClass="text-muted-foreground"
          />
          <div className="bg-muted/50 rounded-lg p-3 sm:p-4 border border-border">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-error-600 dark:text-error-400" aria-hidden="true">
                  <TrendingDown className="w-4 h-4" />
                </span>
                <span className="text-xs sm:text-sm text-muted-foreground font-medium">Total Loss</span>
              </div>
              <InfoTooltip
                label="Total Loss"
                description="Sum of all subscriber losses attributed to this issue (unsubscribes + cleaned + manual removals)."
              />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-foreground">
              {formatNumber(totalLoss)}
            </div>
            {lossPercentage !== null && (
              <div className="text-xs text-muted-foreground mt-1">
                {lossPercentage.toFixed(2)}% of subscribers
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

SubscriberMetricsPanel.displayName = 'SubscriberMetricsPanel';
