/**
 * Example usage of DeliverabilityHealthCard component
 *
 * This file demonstrates how to use the DeliverabilityHealthCard component
 * in the Issue Detail Page redesign.
 */

import React from 'react';
import { DeliverabilityHealthCard } from './DeliverabilityHealthCard';

export const DeliverabilityHealthCardExample: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold mb-6">DeliverabilityHealthCard Examples</h1>

      {/* Example 1: Excellent health */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 1: Excellent Health</h2>
        <DeliverabilityHealthCard bounceRate={1.2} complaintRate={0.005} />
      </div>

      {/* Example 2: Good health */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 2: Good Health</h2>
        <DeliverabilityHealthCard bounceRate={3.5} complaintRate={0.03} />
      </div>

      {/* Example 3: Warning - elevated bounce rate */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 3: Warning - Elevated Bounce Rate</h2>
        <DeliverabilityHealthCard bounceRate={6.5} complaintRate={0.04} />
      </div>

      {/* Example 4: Warning - elevated complaint rate */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 4: Warning - Elevated Complaint Rate</h2>
        <DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.08} />
      </div>

      {/* Example 5: Critical - high bounce rate */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 5: Critical - High Bounce Rate</h2>
        <DeliverabilityHealthCard bounceRate={12.5} complaintRate={0.04} />
      </div>

      {/* Example 6: Critical - high complaint rate */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 6: Critical - High Complaint Rate</h2>
        <DeliverabilityHealthCard bounceRate={3.0} complaintRate={0.15} />
      </div>

      {/* Example 7: With bounce reasons */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 7: With Bounce Reasons</h2>
        <DeliverabilityHealthCard
          bounceRate={4.2}
          complaintRate={0.03}
          bounceReasons={{
            permanent: 15,
            temporary: 8,
            suppressed: 3,
          }}
        />
      </div>

      {/* Example 8: With complaint details */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 8: With Complaint Details</h2>
        <DeliverabilityHealthCard
          bounceRate={2.5}
          complaintRate={0.06}
          complaintDetails={[
            { email: 'user1@example.com', timestamp: '2024-01-01', complaintType: 'spam' },
            { email: 'user2@example.com', timestamp: '2024-01-02', complaintType: 'spam' },
            { email: 'user3@example.com', timestamp: '2024-01-03', complaintType: 'spam' },
          ]}
        />
      </div>

      {/* Example 9: Complete data with both warnings */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Example 9: Complete Data with Both Warnings
        </h2>
        <DeliverabilityHealthCard
          bounceRate={8.5}
          complaintRate={0.12}
          bounceReasons={{
            permanent: 45,
            temporary: 20,
            suppressed: 10,
          }}
          complaintDetails={[
            { email: 'user1@example.com', timestamp: '2024-01-01', complaintType: 'spam' },
            { email: 'user2@example.com', timestamp: '2024-01-02', complaintType: 'spam' },
            { email: 'user3@example.com', timestamp: '2024-01-03', complaintType: 'spam' },
            { email: 'user4@example.com', timestamp: '2024-01-04', complaintType: 'spam' },
            { email: 'user5@example.com', timestamp: '2024-01-05', complaintType: 'spam' },
          ]}
        />
      </div>
    </div>
  );
};

/**
 * Usage in IssueDetailPage:
 *
 * ```tsx
 * import { DeliverabilityHealthCard } from '@/components/issues';
 *
 * // In your component:
 * const bounceRate = (stats.bounces / stats.deliveries) * 100;
 * const complaintRate = (stats.complaints / stats.deliveries) * 100;
 *
 * return (
 *   <CollapsibleSection
 *     id="deliverability"
 *     title="Deliverability & Quality"
 *     description="Bounce analysis, complaints, and quality signals"
 *     icon={<Shield className="h-5 w-5" />}
 *     isExpanded={expandedSections.has('deliverability')}
 *     onToggle={handleToggle}
 *   >
 *     <DeliverabilityHealthCard
 *       bounceRate={bounceRate}
 *       complaintRate={complaintRate}
 *       bounceReasons={analytics?.bounceReasons}
 *       complaintDetails={analytics?.complaintDetails}
 *     />
 *     <BounceReasonsChart bounceReasons={analytics.bounceReasons} />
 *     <ComplaintDetailsTable complaintDetails={analytics.complaintDetails} />
 *   </CollapsibleSection>
 * );
 * ```
 *
 * Health Status Calculation:
 * - Excellent: bounceRate < 2% AND complaintRate < 0.01%
 * - Good: bounceRate < 5% AND complaintRate < 0.05%
 * - Warning: bounceRate >= 5% OR complaintRate >= 0.05%
 * - Critical: bounceRate > 10% OR complaintRate > 0.1%
 *
 * Color Zones:
 * - Bounce Rate:
 *   - Green (Good): 0-2%
 *   - Yellow (Warning): 2-5%
 *   - Red (Critical): 5%+
 * - Complaint Rate:
 *   - Green (Good): 0-0.01%
 *   - Yellow (Warning): 0.01-0.1%
 *   - Red (Critical): 0.1%+
 *
 * Warning Banners:
 * - High Bounce Rate: Shown when bounceRate > 5%
 *   - Provides actionable recommendations
 *   - Suggests list cleaning and double opt-in
 * - High Complaint Rate: Shown when complaintRate > 0.1%
 *   - Critical warning with strong language
 *   - Emphasizes sender reputation impact
 *
 * Progress Bars:
 * - Visual representation with color zones
 * - Animated transitions
 * - ARIA attributes for accessibility
 * - Tooltips with detailed explanations
 *
 * Additional Context:
 * - Bounce reasons breakdown (permanent, temporary, suppressed)
 * - Complaint count with proper pluralization
 * - Only shown when data is available
 *
 * Accessibility:
 * - Proper ARIA labels and roles
 * - Status role for health indicator
 * - Alert role for warning banners
 * - Progress bars with aria-valuenow, aria-valuemin, aria-valuemax
 * - Tooltips with keyboard accessibility
 * - Screen reader friendly text
 *
 * Design Features:
 * - Large, prominent health indicator with icon
 * - Color-coded status (success, primary, warning, error)
 * - Contextual messages based on health status
 * - Visual progress bars with color zones
 * - Warning banners with actionable recommendations
 * - Clean, modern card design
 * - Responsive layout
 */
