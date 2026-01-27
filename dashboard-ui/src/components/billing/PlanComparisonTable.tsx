import React from 'react';
import { Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { formatPrice, getPlansInOrder } from '@/constants';
import type { SubscriptionPlan } from '@/types';

interface PlanComparisonTableProps {
  plans?: SubscriptionPlan[];
  currentPlanId?: string;
  loading?: boolean;
  onSelectPlan: (planId: string) => void;
}

interface FeatureRowProps {
  feature: string;
  plans: SubscriptionPlan[];
  getValue: (plan: SubscriptionPlan) => boolean | string | number;
  formatValue?: (value: boolean | string | number) => React.ReactNode;
}

function FeatureRow({ feature, plans, getValue, formatValue }: FeatureRowProps) {
  return (
    <tr className="border-b border-border">
      <td className="py-3 px-4 text-sm font-medium text-foreground">{feature}</td>
      {plans.map((plan) => {
        const value = getValue(plan);
        const formattedValue = formatValue ? formatValue(value) : value;

        return (
          <td key={plan.id} className="py-3 px-4 text-center">
            {typeof value === 'boolean' ? (
              value ? (
                <Check className="w-5 h-5 text-success-500 mx-auto" />
              ) : (
                <X className="w-5 h-5 text-muted-foreground/60 mx-auto" />
              )
            ) : (
              <span className="text-sm text-muted-foreground">{formattedValue}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

export function PlanComparisonTable({
  plans = getPlansInOrder(),
  currentPlanId,
  loading = false,
  onSelectPlan
}: PlanComparisonTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare Plans</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            {/* Header */}
            <thead>
              <tr className="border-b-2 border-border">
                <th className="py-4 px-4 text-left">
                  <span className="text-lg font-semibold text-foreground">Features</span>
                </th>
                {plans.map((plan) => (
                  <th key={plan.id} className="py-4 px-4 text-center">
                    <div className="space-y-2">
                      <div className="text-lg font-bold text-foreground">{plan.name}</div>
                      <div className="text-2xl font-bold text-primary-600">
                        {formatPrice(plan.price)}
                        {plan.price > 0 && <span className="text-sm text-muted-foreground">/mo</span>}
                      </div>
                      {plan.popular && (
                        <div className="inline-block bg-primary-100 text-primary-800 text-xs px-2 py-1 rounded-full">
                          Most Popular
                        </div>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            {/* Features */}
            <tbody>
              <FeatureRow
                feature="Subscribers"
                plans={plans}
                getValue={(plan) => plan.limits.subscribers}
                formatValue={(value) => (value as number).toLocaleString()}
              />

              <FeatureRow
                feature="Monthly Emails"
                plans={plans}
                getValue={(plan) => plan.limits.monthlyEmails}
                formatValue={(value) => (value as number).toLocaleString()}
              />

              <FeatureRow
                feature="Custom Domain"
                plans={plans}
                getValue={(plan) => plan.limits.customDomain}
              />

              <FeatureRow
                feature="Sponsor Reminders"
                plans={plans}
                getValue={(plan) => plan.limits.sponsorReminders}
              />

              <FeatureRow
                feature="API Access"
                plans={plans}
                getValue={(plan) => plan.limits.apiAccess || false}
              />

              <FeatureRow
                feature="Advanced Analytics"
                plans={plans}
                getValue={(plan) => plan.limits.analytics || false}
              />

              <FeatureRow
                feature="Support"
                plans={plans}
                getValue={(plan) => plan.limits.support || 'community'}
                formatValue={(value) => (value as string).charAt(0).toUpperCase() + (value as string).slice(1)}
              />
            </tbody>

            {/* Action Buttons */}
            <tfoot>
              <tr>
                <td className="py-4 px-4"></td>
                {plans.map((plan) => (
                  <td key={plan.id} className="py-4 px-4 text-center">
                    {plan.id === currentPlanId ? (
                      <Button variant="outline" disabled className="w-full">
                        Current Plan
                      </Button>
                    ) : (
                      <Button
                        onClick={() => onSelectPlan(plan.id)}
                        disabled={loading}
                        className="w-full"
                      >
                        {plan.price === 0 ? 'Downgrade' : 'Upgrade'}
                      </Button>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Additional Information */}
        <div className="mt-6 space-y-4">
          <div className="bg-background rounded-lg p-4">
            <h4 className="text-sm font-medium text-foreground mb-2">What&apos;s included in all plans:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>&bull; Unlimited newsletters</li>
              <li>&bull; Basic email analytics</li>
              <li>&bull; Newsletter templates</li>
              <li>&bull; Subscriber management</li>
              <li>&bull; Email deliverability optimization</li>
            </ul>
          </div>

          <div className="bg-primary-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-primary-800 mb-2">Billing Information:</h4>
            <ul className="text-sm text-primary-700 space-y-1">
              <li>&bull; All plans are billed monthly</li>
              <li>&bull; Upgrades are prorated and take effect immediately</li>
              <li>&bull; Downgrades take effect at the end of your billing cycle</li>
              <li>&bull; Cancel anytime with no long-term commitments</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default PlanComparisonTable;

