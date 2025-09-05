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
    <tr className="border-b border-gray-200">
      <td className="py-3 px-4 text-sm font-medium text-gray-900">{feature}</td>
      {plans.map((plan) => {
        const value = getValue(plan);
        const formattedValue = formatValue ? formatValue(value) : value;

        return (
          <td key={plan.id} className="py-3 px-4 text-center">
            {typeof value === 'boolean' ? (
              value ? (
                <Check className="w-5 h-5 text-green-500 mx-auto" />
              ) : (
                <X className="w-5 h-5 text-gray-300 mx-auto" />
              )
            ) : (
              <span className="text-sm text-gray-700">{formattedValue}</span>
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
              <tr className="border-b-2 border-gray-200">
                <th className="py-4 px-4 text-left">
                  <span className="text-lg font-semibold text-gray-900">Features</span>
                </th>
                {plans.map((plan) => (
                  <th key={plan.id} className="py-4 px-4 text-center">
                    <div className="space-y-2">
                      <div className="text-lg font-bold text-gray-900">{plan.name}</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {formatPrice(plan.price)}
                        {plan.price > 0 && <span className="text-sm text-gray-500">/mo</span>}
                      </div>
                      {plan.popular && (
                        <div className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
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
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">What's included in all plans:</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Unlimited newsletters</li>
              <li>• Basic email analytics</li>
              <li>• Newsletter templates</li>
              <li>• Subscriber management</li>
              <li>• Email deliverability optimization</li>
            </ul>
          </div>

          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-blue-800 mb-2">Billing Information:</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• All plans are billed monthly</li>
              <li>• Upgrades are prorated and take effect immediately</li>
              <li>• Downgrades take effect at the end of your billing cycle</li>
              <li>• Cancel anytime with no long-term commitments</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default PlanComparisonTable;
