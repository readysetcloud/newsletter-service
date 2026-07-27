import React, { useMemo } from 'react';
import { Send, CheckCircle2, MailOpen, MousePointerClick, CornerDownRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { InfoTooltip } from '../ui/InfoTooltip';
import { formatNumber, formatPercentageValue } from '../../utils/issueDetailUtils';

export interface EngagementFunnelProps {
  /** Number of emails successfully delivered to recipients. */
  delivered: number;
  /** Number of emails that bounced (could not be delivered). */
  bounced: number;
  /** Number of recipients who opened the issue. */
  opens: number;
  /** Number of recipients who clicked at least one link. */
  clicks: number;
}

interface FunnelStage {
  key: string;
  label: string;
  icon: React.ReactNode;
  value: number;
  /** Share of sent, 0-100, used for the bar width. */
  percentOfSent: number;
  barClass: string;
  /** Connector line describing the transition from the previous stage. */
  transition?: string;
}

/**
 * The funnel reads top-down as a sequential ramp of the primary hue — each
 * stage is a strict subset of the one above, so depth encodes progression.
 * The token scales invert in dark mode, so these single classes render
 * light-to-dark on light surfaces and dark-to-light on dark ones.
 */
const STAGE_BAR_CLASSES = [
  'bg-primary-300',
  'bg-primary-400',
  'bg-primary-500',
  'bg-primary-600',
];

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export const EngagementFunnel: React.FC<EngagementFunnelProps> = React.memo(({
  delivered,
  bounced,
  opens,
  clicks,
}) => {
  const safeDelivered = Math.max(0, delivered || 0);
  const safeBounced = Math.max(0, bounced || 0);
  const safeOpens = Math.max(0, opens || 0);
  const safeClicks = Math.max(0, clicks || 0);
  const sent = safeDelivered + safeBounced;

  const stages = useMemo<FunnelStage[]>(() => {
    if (sent === 0) return [];

    const deliveryRate = (safeDelivered / sent) * 100;
    const openRate = safeDelivered > 0 ? (safeOpens / safeDelivered) * 100 : 0;
    const clickToOpenRate = safeOpens > 0 ? (safeClicks / safeOpens) * 100 : 0;

    return [
      {
        key: 'sent',
        label: 'Sent',
        icon: <Send className="w-4 h-4" aria-hidden="true" />,
        value: sent,
        percentOfSent: 100,
        barClass: STAGE_BAR_CLASSES[0],
      },
      {
        key: 'delivered',
        label: 'Delivered',
        icon: <CheckCircle2 className="w-4 h-4" aria-hidden="true" />,
        value: safeDelivered,
        percentOfSent: clampPercent(deliveryRate),
        barClass: STAGE_BAR_CLASSES[1],
        transition: safeBounced > 0
          ? `${formatPercentageValue(deliveryRate, 1)} delivered — ${formatNumber(safeBounced)} bounced`
          : `${formatPercentageValue(deliveryRate, 1)} delivered`,
      },
      {
        key: 'opened',
        label: 'Opened',
        icon: <MailOpen className="w-4 h-4" aria-hidden="true" />,
        value: safeOpens,
        percentOfSent: clampPercent((safeOpens / sent) * 100),
        barClass: STAGE_BAR_CLASSES[2],
        transition: `${formatPercentageValue(openRate, 1)} of delivered opened`,
      },
      {
        key: 'clicked',
        label: 'Clicked',
        icon: <MousePointerClick className="w-4 h-4" aria-hidden="true" />,
        value: safeClicks,
        percentOfSent: clampPercent((safeClicks / sent) * 100),
        barClass: STAGE_BAR_CLASSES[3],
        transition: `${formatPercentageValue(clickToOpenRate, 1)} of opens clicked`,
      },
    ];
  }, [sent, safeDelivered, safeBounced, safeOpens, safeClicks]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
            Engagement Funnel
          </CardTitle>
          <InfoTooltip
            label="Engagement Funnel"
            description="How your audience moved through this issue — from every email sent, to those delivered, opened, and clicked. Each bar is sized against the total sent, and the connectors show the conversion between stages."
          />
        </div>
      </CardHeader>

      <CardContent>
        {sent === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No delivery data available for this issue.
          </div>
        ) : (
          <ol
            className="space-y-1"
            aria-label={`Engagement funnel: ${formatNumber(sent)} sent, ${formatNumber(safeDelivered)} delivered, ${formatNumber(safeOpens)} opened, ${formatNumber(safeClicks)} clicked.`}
          >
            {stages.map((stage) => (
              <li key={stage.key}>
                {stage.transition && (
                  <div className="flex items-center gap-1.5 pl-1 py-1.5 text-xs text-muted-foreground">
                    <CornerDownRight className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                    <span>{stage.transition}</span>
                  </div>
                )}
                <div className="group rounded-lg px-1 py-1 -mx-1 transition-colors hover:bg-muted/40">
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="text-muted-foreground">{stage.icon}</span>
                      {stage.label}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm sm:text-base font-bold text-foreground tabular-nums">
                        {formatNumber(stage.value)}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                        {formatPercentageValue(stage.percentOfSent, stage.percentOfSent < 10 ? 1 : 0)}
                      </span>
                    </span>
                  </div>
                  <div className="h-5 w-full rounded bg-muted/60 overflow-hidden">
                    <div
                      className={`h-full rounded transition-all duration-500 ease-out ${stage.barClass}`}
                      style={{ width: `${Math.max(stage.value > 0 ? 1 : 0, stage.percentOfSent)}%` }}
                      role="presentation"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
});

EngagementFunnel.displayName = 'EngagementFunnel';

export default EngagementFunnel;
