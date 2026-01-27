import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { BillingPage as BillingPageComponent } from '@/components/billing/BillingPage';
import { useToast } from '@/components/ui/Toast';

export function BillingPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  // Check if user has admin access
  const hasAdminAccess = user?.isAdmin || user?.isTenantAdmin;

  if (!hasAdminAccess) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-warning-50 border border-warning-200 rounded-lg p-6 text-center">
          <h2 className="text-lg font-semibold text-warning-900 mb-2">Access Restricted</h2>
          <p className="text-warning-700">
            Only tenant administrators can access billing and subscription management.
          </p>
        </div>
      </div>
    );
  }

  const handleError = (error: string) => {
    addToast({ type: 'error', title: 'Error', message: error });
  };

  const handleSuccess = (message: string) => {
    addToast({ type: 'success', title: 'Success', message });
  };

  return (
    <BillingPageComponent
      onError={handleError}
      onSuccess={handleSuccess}
    />
  );
}

export default BillingPage;
