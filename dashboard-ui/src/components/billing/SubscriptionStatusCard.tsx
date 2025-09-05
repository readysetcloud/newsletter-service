import React from 'react';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  CreditCard,
  Calendar,
  Users,
  Mail
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { formatPrice, SUBSCRIPTION_STATUS_INFO } from '@/constants';
import type {
  Subscription,
  SubscriptionPlan,
  UsageMetrics,
  BillingInfo,
  SubscriptionCardProps
} from '@/types';

interface SubscriptionStatusCardProps extends SubscriptionCardProps {
  subscription: Subscription | null;
  plan: SubscriptionPlan;
  usage?: UsageMetrics;
  billingInfo?: BillingInfo;
  loading?: boolean;
  onUpgrade?: () => void;
  onManage?: () => void;
}

export function SubscriptionStatusCard({
  subscription,
  plan,
  usage,
  billingInfo,
  loading = false,
  onUpgrade,
  onManage
}: SubscriptionStatusCardProps) {
  const getStatusIcon = () => {
    if (!subscription) return <Clock className="w-5 h-5 text-gray-400" />;

    switch (subscription.status) {
      case 'active':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'trialing':
        return <Clock className="w-5 h-5 text-blue-500" />;
      case 'past_due':
      case 'unpaid':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'cancelled':
      case 'incomplete':
      case 'incomplete_expired':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = () => {
    if (!subscription) return 'text-gray-600';

    const statusInfo = SUBSCRIPTION_STATUS_INFO[subscription.status];
    switch (statusInfo.color) {
      case 'green': return 'text-green-600';
      case 'blue': return 'text-blue-600';
      case 'yellow': return 'text-yellow-600';
      case 'red': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-8 bg-gray-200 rounded w-full"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {getStatusIcon()}
          Subscription Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Plan */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-900">{plan.name} Plan</h3>
            <span className="text-2xl font-bold text-gray-900">
              {formatPrice(plan.price)}
              {plan.price > 0 && <span className="text-sm font-normal text-gray-500">/month</span>}
            </span>
          </div>

          {subscription && (
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${getStatusColor()}`}>
                {SUBSCRIPTION_STATUS_INFO[subscription.status].label}
              </span>
              <span className="text-sm text-gray-500">
                • {SUBSCRIPTION_STATUS_INFO[subscription.status].description}
              </span>
            </div>
          )}
        </div>

        {/* Billing Information */}
        {subscription && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-gray-400" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {subscription.cancelAtPeriodEnd ? 'Expires' : 'Next billing'}
                </p>
                <p className="text-sm text-gray-500">
                  {formatDate(subscription.currentPeriodEnd)}
                </p>
              </div>
            </div>

            {billingInfo?.paymentMethod && (
              <div className="flex items-center gap-3">
                <CreditCard className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Payment method</p>
                  <p className="text-sm text-gray-500">
                    {billingInfo.paymentMethod.card.brand.toUpperCase()} ••••{billingInfo.paymentMethod.card.last4}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Usage Summary */}
        {usage && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Current Usage</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Subscribers</p>
                  <p className="text-sm text-gray-500">
                    {usage.subscribers.current.toLocaleString()} / {usage.subscribers.limit.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Monthly emails</p>
                  <p className="text-sm text-gray-500">
                    {usage.monthlyEmails.current.toLocaleString()} / {usage.monthlyEmails.limit.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
          {subscription?.status === 'active' && onManage && (
            <Button
              variant="outline"
              onClick={onManage}
              className="flex-1"
            >
              Manage Subscription
            </Button>
          )}

          {(!subscription || subscription.status !== 'active' || plan.id === 'free') && onUpgrade && (
            <Button
              onClick={onUpgrade}
              className="flex-1"
            >
              {subscription?.status === 'active' ? 'Upgrade Plan' : 'Subscribe Now'}
            </Button>
          )}

          {subscription?.status === 'past_due' && onManage && (
            <Button
              onClick={onManage}
              className="flex-1"
            >
              Update Payment
            </Button>
          )}
        </div>

        {/* Cancellation Notice */}
        {subscription?.cancelAtPeriodEnd && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-yellow-800">
                  Subscription Cancelled
                </h4>
                <p className="text-sm text-yellow-700 mt-1">
                  Your subscription will end on {formatDate(subscription.currentPeriodEnd)}.
                  You'll continue to have access to premium features until then.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SubscriptionStatusCard;
