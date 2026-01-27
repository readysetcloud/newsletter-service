import React, { useState } from 'react';
import {
  CreditCard,
  FileText,
  Settings,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { billingService } from '@/services';
import type { Subscription, BillingInfo } from '@/types';

interface BillingManagementProps {
  subscription: Subscription | null;
  billingInfo?: BillingInfo;
  loading?: boolean;
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

interface ActionButtonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonText: string;
  loading: boolean;
  onClick: () => void;
  variant?: 'primary' | 'outline';
}

function ActionButton({
  icon,
  title,
  description,
  buttonText,
  loading,
  onClick,
  variant = 'outline'
}: ActionButtonProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-primary-50 rounded-lg">
            {icon}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground mb-4">{description}</p>
            <Button
              variant={variant}
              onClick={onClick}
              disabled={loading}
              className="flex items-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              {loading ? 'Opening...' : buttonText}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function BillingManagement({
  subscription,
  billingInfo,
  loading = false,
  onError,
  onSuccess: _onSuccess
}: BillingManagementProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleCustomerPortal = async (action: string) => {
    try {
      setActionLoading(action);

      const response = await billingService.createCustomerPortalSession({
        returnUrl: `${window.location.origin}/billing`
      });

      if (response.success && response.data) {
        // Open in same window for better UX
        billingService.redirectToCustomerPortal(response.data.url);
      } else {
        throw new Error(response.error || 'Failed to access customer portal');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      onError?.(errorMessage);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdatePaymentMethod = () => handleCustomerPortal('payment');
  const handleViewInvoices = () => handleCustomerPortal('invoices');
  const handleManageSubscription = () => handleCustomerPortal('subscription');

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-8 bg-muted rounded w-full"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Billing Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Manage your subscription, payment methods, and billing information through Stripe&apos;s secure customer portal.
          </p>

          {/* Current Payment Method */}
          {billingInfo?.paymentMethod && (
            <div className="bg-background rounded-lg p-4 mb-4">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Current Payment Method</p>
                  <p className="text-sm text-muted-foreground">
                    {billingInfo.paymentMethod.card.brand.toUpperCase()} &bull;&bull;&bull;&bull;{billingInfo.paymentMethod.card.last4}
                    {' '}expires {billingInfo.paymentMethod.card.expMonth}/{billingInfo.paymentMethod.card.expYear}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Subscription Status */}
          {subscription && (
            <div className="bg-primary-50 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary-600" />
                <div>
                  <p className="text-sm font-medium text-primary-900">Active Subscription</p>
                  <p className="text-sm text-primary-700">
                    {subscription.plan.name} plan &bull; Next billing: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <ActionButton
          icon={<CreditCard className="w-5 h-5 text-primary-600" />}
          title="Update Payment Method"
          description="Add or update your credit card and billing information"
          buttonText="Manage Payment"
          loading={actionLoading === 'payment'}
          onClick={handleUpdatePaymentMethod}
        />

        <ActionButton
          icon={<FileText className="w-5 h-5 text-primary-600" />}
          title="View Invoices"
          description="Download invoices and view your billing history"
          buttonText="View Invoices"
          loading={actionLoading === 'invoices'}
          onClick={handleViewInvoices}
        />

        <ActionButton
          icon={<Settings className="w-5 h-5 text-primary-600" />}
          title="Manage Subscription"
          description="Update your plan, cancel subscription, or change billing cycle"
          buttonText="Manage Plan"
          loading={actionLoading === 'subscription'}
          onClick={handleManageSubscription}
          variant="primary"
        />
      </div>

      {/* Information Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">
                Secure Billing Management
              </h4>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>&bull; All billing operations are handled securely through Stripe</p>
                <p>&bull; Your payment information is never stored on our servers</p>
                <p>&bull; You can cancel or modify your subscription at any time</p>
                <p>&bull; Changes take effect immediately or at the next billing cycle</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default BillingManagement;

