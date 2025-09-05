import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { billingService } from '@/services';
import { SubscriptionStatusCard } from './SubscriptionStatusCard';
import { UsageDisplay } from './UsageDisplay';
import { BillingAlerts } from './BillingAlerts';
import { PlanSelector } from './PlanSelector';
import { BillingManagement } from './BillingManagement';
import { getPlansInOrder } from '@/constants';
import type {
  SubscriptionStatusResponse,
  BillingAlert,
  BillingLoadingState
} from '@/types';

interface BillingPageProps {
  onError?: (error: string) => void;
  onSuccess?: (message: string) => void;
}

export function BillingPage({ onError, onSuccess }: BillingPageProps) {
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionStatusResponse | null>(null);
  const [alerts, setAlerts] = useState<BillingAlert[]>([]);
  const [loading, setLoading] = useState<BillingLoadingState>({
    subscription: true,
    checkout: false,
    portal: false,
    planChange: false,
    usage: false
  });
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'plans' | 'manage'>('overview');

  // Load subscription data
  const loadSubscriptionData = async () => {
    try {
      setLoading(prev => ({ ...prev, subscription: true }));
      setError(null);

      const [subscriptionResponse, alertsResponse] = await Promise.all([
        billingService.getSubscriptionStatus(),
        billingService.getBillingAlerts()
      ]);

      if (subscriptionResponse.success && subscriptionResponse.data) {
        setSubscriptionData(subscriptionResponse.data);
      } else {
        throw new Error(subscriptionResponse.error || 'Failed to load subscription data');
      }

      if (alertsResponse.success && alertsResponse.data) {
        setAlerts(alertsResponse.data);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load billing data';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(prev => ({ ...prev, subscription: false }));
    }
  };

  // Handle plan selection
  const handlePlanSelect = async (planId: string) => {
    try {
      setLoading(prev => ({ ...prev, checkout: true }));

      const response = await billingService.createCheckoutSession({
        planId,
        successUrl: `${window.location.origin}/billing?success=true`,
        cancelUrl: `${window.location.origin}/billing?cancelled=true`
      });

      if (response.success && response.data) {
        billingService.redirectToCheckout(response.data.url);
      } else {
        throw new Error(response.error || 'Failed to create checkout session');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start checkout';
      onError?.(errorMessage);
    } finally {
      setLoading(prev => ({ ...prev, checkout: false }));
    }
  };

  // Handle alert dismissal
  const handleDismissAlert = async (alertId: string) => {
    try {
      const response = await billingService.dismissAlert(alertId);

      if (response.success) {
        setAlerts(prev => prev.filter(alert => alert.id !== alertId));
        onSuccess?.('Alert dismissed');
      } else {
        throw new Error(response.error || 'Failed to dismiss alert');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to dismiss alert';
      onError?.(errorMessage);
    }
  };

  // Handle alert action
  const handleAlertAction = (alert: BillingAlert) => {
    if (alert.actionUrl) {
      window.open(alert.actionUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Handle upgrade from usage display
  const handleUpgrade = () => {
    setActiveTab('plans');
  };

  // Handle manage subscription
  const handleManageSubscription = () => {
    setActiveTab('manage');
  };

  // Load data on mount
  useEffect(() => {
    loadSubscriptionData();
  }, []);

  // Handle URL parameters (success/cancel from Stripe)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get('success') === 'true') {
      onSuccess?.('Subscription updated successfully!');
      loadSubscriptionData(); // Refresh data

      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (urlParams.get('cancelled') === 'true') {
      onError?.('Checkout was cancelled');

      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [onSuccess, onError]);

  if (error && !subscriptionData) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-red-900 mb-2">Failed to Load Billing Data</h2>
          <p className="text-red-700 mb-4">{error}</p>
          <Button onClick={loadSubscriptionData} className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Billing & Subscription</h1>
        <p className="text-gray-600">
          Manage your subscription, view usage, and update billing information.
        </p>
      </div>

      {/* Billing Alerts */}
      {alerts.length > 0 && (
        <BillingAlerts
          alerts={alerts}
          onDismiss={handleDismissAlert}
          onAction={handleAlertAction}
        />
      )}

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('plans')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'plans'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Plans & Pricing
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'manage'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Manage Billing
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && subscriptionData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <SubscriptionStatusCard
              subscription={subscriptionData.subscription}
              plan={subscriptionData.currentPlan}
              usage={subscriptionData.usage}
              billingInfo={subscriptionData.billingInfo}
              loading={loading.subscription}
              onUpgrade={handleUpgrade}
              onManage={handleManageSubscription}
            />
          </div>

          <div className="space-y-6">
            <UsageDisplay
              usage={subscriptionData.usage}
              plan={subscriptionData.currentPlan}
              onUpgrade={handleUpgrade}
            />
          </div>
        </div>
      )}

      {activeTab === 'plans' && (
        <PlanSelector
          plans={getPlansInOrder()}
          currentPlanId={subscriptionData?.currentPlan.id}
          loading={loading.checkout}
          onSelectPlan={handlePlanSelect}
        />
      )}

      {activeTab === 'manage' && (
        <BillingManagement
          subscription={subscriptionData?.subscription || null}
          billingInfo={subscriptionData?.billingInfo}
          loading={loading.portal}
          onError={onError}
          onSuccess={onSuccess}
        />
      )}

      {/* Refresh Button */}
      <div className="flex justify-center pt-6">
        <Button
          variant="outline"
          onClick={loadSubscriptionData}
          disabled={loading.subscription}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading.subscription ? 'animate-spin' : ''}`} />
          Refresh Data
        </Button>
      </div>
    </div>
  );
}

export default BillingPage;
