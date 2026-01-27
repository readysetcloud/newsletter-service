import React, { useState } from 'react';
import { Check, Star, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { formatPrice, getPlansInOrder } from '@/constants';
import type { PlanSelectorProps, SubscriptionPlan } from '@/types';

interface PlanCardProps {
  plan: SubscriptionPlan;
  isCurrentPlan: boolean;
  isPopular?: boolean;
  loading: boolean;
  onSelect: (planId: string) => void;
}

function PlanCard({ plan, isCurrentPlan, isPopular, loading, onSelect }: PlanCardProps) {
  const handleSelect = () => {
    if (!isCurrentPlan && !loading) {
      onSelect(plan.id);
    }
  };

  return (
    <Card className={`relative ${isPopular ? 'border-primary-500 shadow-lg' : ''} ${isCurrentPlan ? 'bg-background' : ''}`}>
      {isPopular && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <div className="bg-primary-500 text-white px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
            <Star className="w-3 h-3" />
            Most Popular
          </div>
        </div>
      )}

      <CardHeader className="text-center pb-4">
        <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
        <div className="mt-2">
          <span className="text-3xl font-bold">{formatPrice(plan.price)}</span>
          {plan.price > 0 && <span className="text-muted-foreground text-sm">/month</span>}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Plan Features */}
        <div className="space-y-2">
          {plan.features.map((feature, index) => (
            <div key={index} className="flex items-center gap-2">
              <Check className="w-4 h-4 text-success-500 flex-shrink-0" />
              <span className="text-sm text-muted-foreground">{feature}</span>
            </div>
          ))}
        </div>

        {/* Plan Limits */}
        <div className="border-t pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subscribers</span>
            <span className="font-medium">{plan.limits.subscribers.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Monthly Emails</span>
            <span className="font-medium">{plan.limits.monthlyEmails.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Support</span>
            <span className="font-medium capitalize">{plan.limits.support || 'Community'}</span>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-4">
          {isCurrentPlan ? (
            <Button
              variant="outline"
              className="w-full"
              disabled
            >
              Current Plan
            </Button>
          ) : (
            <Button
              onClick={handleSelect}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                plan.price === 0 ? 'Downgrade to Free' : 'Upgrade to ' + plan.name
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PlanSelector({
  plans = getPlansInOrder(),
  currentPlanId,
  loading = false,
  onSelectPlan
}: PlanSelectorProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const handlePlanSelect = (planId: string) => {
    setSelectedPlanId(planId);
    onSelectPlan(planId);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-foreground mb-2">Choose Your Plan</h2>
        <p className="text-muted-foreground">
          Select the plan that best fits your newsletter needs. You can upgrade or downgrade at any time.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrentPlan={plan.id === currentPlanId}
            isPopular={plan.popular}
            loading={loading && selectedPlanId === plan.id}
            onSelect={handlePlanSelect}
          />
        ))}
      </div>

      {/* Plan Comparison Note */}
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-primary-800 mb-2">Plan Change Information</h3>
        <ul className="text-sm text-primary-700 space-y-1">
          <li>• Upgrades take effect immediately with prorated billing</li>
          <li>• Downgrades take effect at the end of your current billing period</li>
          <li>• You can cancel your subscription at any time</li>
          <li>• All plans include unlimited newsletters and basic analytics</li>
        </ul>
      </div>
    </div>
  );
}

export default PlanSelector;
