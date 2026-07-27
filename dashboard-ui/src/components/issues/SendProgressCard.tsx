import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe2,
  Loader2,
  MinusCircle,
  SendHorizonal
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { useTenantDateFormat } from '@/contexts/SettingsContext';
import { cn } from '../../utils/cn';
import type { SendProgress, SendProgressGroup, WorkflowState } from '../../types/issues';

export interface SendProgressCardProps {
  /** Group-by-group delivery state, once the issue has fanned out. */
  sendProgress?: SendProgress;
  /**
   * Where the publish workflow is. The API returns this only when there is no
   * send progress yet (a scheduled issue waiting for its send time) or when the
   * workflow failed, so the two are rendered as alternatives rather than
   * stacked.
   */
  workflow?: WorkflowState;
  className?: string;
}

const STATE_CONFIG: Record<
  SendProgress['state'],
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  sending: {
    label: 'Sending',
    className:
      'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-800/60 dark:text-sky-100 dark:border-sky-400',
    icon: SendHorizonal
  },
  complete: {
    label: 'Delivered',
    className:
      'bg-green-100 text-green-800 border-green-300 dark:bg-green-800/60 dark:text-green-100 dark:border-green-400',
    icon: CheckCircle2
  },
  stalled: {
    label: 'Needs attention',
    className:
      'bg-red-100 text-red-800 border-red-300 dark:bg-red-800/60 dark:text-red-100 dark:border-red-400',
    icon: AlertTriangle
  }
};

const WORKFLOW_CONFIG: Record<
  WorkflowState['state'],
  { className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  waiting: { className: 'text-muted-foreground', icon: Clock },
  running: { className: 'text-sky-700 dark:text-sky-300', icon: Loader2 },
  failed: { className: 'text-red-700 dark:text-red-300', icon: AlertTriangle },
  stopped: { className: 'text-amber-700 dark:text-amber-300', icon: MinusCircle }
};

/** Per-group row icon. Overdue outranks status: it is the thing to act on. */
const groupIcon = (group: SendProgressGroup) => {
  if (group.overdue) return AlertTriangle;
  if (group.status === 'sent') return CheckCircle2;
  if (group.status === 'empty') return MinusCircle;
  return Clock;
};

const groupIconClass = (group: SendProgressGroup) => {
  if (group.overdue) return 'text-red-600 dark:text-red-400';
  if (group.status === 'sent') return 'text-green-600 dark:text-green-400';
  if (group.status === 'empty') return 'text-muted-foreground';
  return 'text-muted-foreground';
};

export const SendProgressCard: React.FC<SendProgressCardProps> = ({
  sendProgress,
  workflow,
  className
}) => {
  const { formatDateTime, formatTime } = useTenantDateFormat();

  // No local send on this issue and nothing notable about the workflow.
  if (!sendProgress && !workflow) {
    return null;
  }

  if (!sendProgress && workflow) {
    const config = WORKFLOW_CONFIG[workflow.state];
    const Icon = config.icon;

    return (
      <Card className={cn('shadow-sm', className)}>
        <CardContent className="p-3 sm:p-4">
          <div className={cn('flex items-start gap-2', config.className)}>
            <Icon
              className={cn('w-4 h-4 mt-0.5 shrink-0', workflow.state === 'running' && 'animate-spin')}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{workflow.message}</p>
              {workflow.detail && (
                <p className="mt-1 text-xs text-muted-foreground break-words">{workflow.detail}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!sendProgress) {
    return null;
  }

  const state = STATE_CONFIG[sendProgress.state];
  const StateIcon = state.icon;
  const percent = sendProgress.groupsTotal
    ? Math.round((sendProgress.groupsDelivered / sendProgress.groupsTotal) * 100)
    : 0;

  return (
    <Card className={cn('shadow-sm', className)}>
      <CardHeader className="bg-muted/30 p-3 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base sm:text-xl flex items-center gap-2">
            <Globe2 className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
            Local send delivery
          </CardTitle>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
              state.className
            )}
            role="status"
          >
            <StateIcon className="w-3 h-3" aria-hidden="true" />
            {state.label}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{sendProgress.message}</p>
      </CardHeader>

      <CardContent className="pt-4 sm:pt-6 p-3 sm:p-6">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={sendProgress.groupsDelivered}
          aria-valuemin={0}
          aria-valuemax={sendProgress.groupsTotal}
          aria-label="Local send groups delivered"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              sendProgress.state === 'stalled' ? 'bg-red-500' : 'bg-sky-500',
              sendProgress.state === 'complete' && 'bg-green-500'
            )}
            style={{ width: `${percent}%` }}
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Groups delivered</dt>
            <dd className="text-sm font-medium text-foreground">
              {sendProgress.groupsDelivered} of {sendProgress.groupsTotal}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Emails sent</dt>
            <dd className="text-sm font-medium text-foreground">
              {sendProgress.recipientsSent.toLocaleString()}
              {sendProgress.totalSubscribers !== undefined && (
                <span className="text-muted-foreground">
                  {' '}
                  of {sendProgress.totalSubscribers.toLocaleString()}
                </span>
              )}
            </dd>
          </div>
          {sendProgress.completedAt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Finished</dt>
              <dd className="text-sm font-medium text-foreground">
                {formatDateTime(sendProgress.completedAt)}
              </dd>
            </div>
          ) : (
            sendProgress.nextSendAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Next group</dt>
                <dd className="text-sm font-medium text-foreground">
                  {formatDateTime(sendProgress.nextSendAt)}
                </dd>
              </div>
            )
          )}
          {!sendProgress.completedAt && sendProgress.expectedCompleteAt && (
            <div>
              <dt className="text-xs text-muted-foreground">Expected complete</dt>
              <dd className="text-sm font-medium text-foreground">
                {formatDateTime(sendProgress.expectedCompleteAt)}
              </dd>
            </div>
          )}
        </dl>

        <ul className="mt-5 divide-y divide-border" aria-label="Send groups">
          {sendProgress.groups.map((group) => {
            const Icon = groupIcon(group);
            return (
              <li key={group.label} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon
                    className={cn('w-4 h-4 shrink-0', groupIconClass(group))}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground" title={group.label}>
                      {group.name}
                    </p>
                    {group.overdue && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        Overdue — this group has not reported back
                      </p>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm text-foreground">
                    {group.status === 'pending'
                      ? formatTime(group.sendAt)
                      : `${(group.recipients ?? 0).toLocaleString()} sent`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {group.status === 'pending'
                      ? group.size !== undefined
                        ? `${group.size.toLocaleString()} queued`
                        : 'scheduled'
                      : group.sentAt
                        ? formatTime(group.sentAt)
                        : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        {sendProgress.mode === 'peak-hour' && (
          <p className="mt-4 text-xs text-muted-foreground">
            Groups are each subscriber&rsquo;s peak open hour, in UTC.
          </p>
        )}
        {sendProgress.mode === 'timezone' && sendProgress.defaultTimeZone && (
          <p className="mt-4 text-xs text-muted-foreground">
            Scheduled time read as a wall-clock time in {sendProgress.defaultTimeZone.replace(/_/g, ' ')}.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

SendProgressCard.displayName = 'SendProgressCard';
