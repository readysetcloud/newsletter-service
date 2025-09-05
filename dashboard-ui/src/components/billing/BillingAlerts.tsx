import React from 'react';
import {
  AlertTriangle,
  XCircle,
  Clock,
  CreditCard,
  X,
  ExternalLink
} from 'lucide-react';
import { Card, CardContent, Button } from '@/components/ui';
import type { BillingAlertsProps, BillingAlert } from '@/types';

interface AlertItemProps {
  alert: BillingAlert;
  onDismiss: (alertId: string) => void;
  onAction: (alert: BillingAlert) => void;
}

function AlertItem({ alert, onDismiss, onAction }: AlertItemProps) {
  const getAlertIcon = () => {
    switch (alert.type) {
      case 'payment_failed':
        return <CreditCard className="w-5 h-5 text-red-500" />;
      case 'usage_limit':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'subscription_cancelled':
        return <XCircle className="w-5 h-5 text-gray-500" />;
      case 'trial_ending':
        return <Clock className="w-5 h-5 text-blue-500" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getAlertBorderColor = () => {
    switch (alert.severity) {
      case 'error': return 'border-red-200 bg-red-50';
      case 'warning': return 'border-yellow-200 bg-yellow-50';
      case 'info': return 'border-blue-200 bg-blue-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  };

  const getActionButtonVariant = (): 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' => {
    switch (alert.severity) {
      case 'error': return 'primary';
      case 'warning': return 'primary';
      case 'info': return 'outline';
      default: return 'outline';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className={`border rounded-lg p-4 ${getAlertBorderColor()}`}>
      <div className="flex items-start gap-3">
        {getAlertIcon()}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h4 className="text-sm font-medium text-gray-900">
                {alert.title}
              </h4>
              <p className="text-sm text-gray-700 mt-1">
                {alert.message}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {formatDate(alert.createdAt)}
              </p>
            </div>
            <button
              onClick={() => onDismiss(alert.id)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {alert.actionRequired && alert.actionUrl && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <Button
                size="sm"
                variant={getActionButtonVariant()}
                onClick={() => onAction(alert)}
                className="flex items-center gap-1"
              >
                Take Action
                <ExternalLink className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BillingAlerts({ alerts, onDismiss, onAction }: BillingAlertsProps) {
  if (!alerts || alerts.length === 0) {
    return null;
  }

  // Sort alerts by severity and creation date
  const sortedAlerts = [...alerts].sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            Billing Alerts
            <span className="text-sm font-normal text-gray-500">
              ({alerts.length})
            </span>
          </h3>
        </div>

        <div className="p-4 space-y-4">
          {sortedAlerts.map((alert) => (
            <AlertItem
              key={alert.id}
              alert={alert}
              onDismiss={onDismiss}
              onAction={onAction}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default BillingAlerts;
