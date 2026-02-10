/**
 * Example usage of CollapsibleSection component
 *
 * This file demonstrates how to use the CollapsibleSection component
 * in the Issue Detail Page redesign.
 */

import React, { useState } from 'react';
import { CollapsibleSection } from './CollapsibleSection';
import { TrendingUp, Users, Shield } from 'lucide-react';

export const CollapsibleSectionExample: React.FC = () => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['engagement'])
  );

  const handleToggle = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold mb-6">CollapsibleSection Examples</h1>

      {/* Example 1: Basic section with content */}
      <CollapsibleSection
        id="engagement"
        title="Engagement Analytics"
        description="Link performance, geographic distribution, and engagement over time"
        icon={<TrendingUp className="h-5 w-5" />}
        isExpanded={expandedSections.has('engagement')}
        onToggle={handleToggle}
        badge="12 links"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This section contains engagement analytics including:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2">
            <li>Link performance table</li>
            <li>Geographic map</li>
            <li>Click decay chart</li>
            <li>Traffic source breakdown</li>
          </ul>
        </div>
      </CollapsibleSection>

      {/* Example 2: Section with numeric badge */}
      <CollapsibleSection
        id="audience"
        title="Audience Insights"
        description="Device breakdown, geography, and engagement timing"
        icon={<Users className="h-5 w-5" />}
        isExpanded={expandedSections.has('audience')}
        onToggle={handleToggle}
        badge={5}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Audience insights help you understand who is engaging with your content.
          </p>
        </div>
      </CollapsibleSection>

      {/* Example 3: Section without badge */}
      <CollapsibleSection
        id="deliverability"
        title="Deliverability & Quality"
        description="Bounce analysis, complaints, and quality signals"
        icon={<Shield className="h-5 w-5" />}
        isExpanded={expandedSections.has('deliverability')}
        onToggle={handleToggle}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Monitor your email deliverability and sender reputation.
          </p>
        </div>
      </CollapsibleSection>

      {/* Example 4: Empty section */}
      <CollapsibleSection
        id="empty-section"
        title="Empty Section"
        description="This section has no data"
        icon={<TrendingUp className="h-5 w-5" />}
        isExpanded={expandedSections.has('empty-section')}
        onToggle={handleToggle}
        isEmpty={true}
        emptyMessage="No analytics data available for this issue yet."
      >
        <div>This content won&apos;t be shown</div>
      </CollapsibleSection>

      {/* Example 5: Section with default expanded */}
      <CollapsibleSection
        id="default-expanded"
        title="Default Expanded Section"
        description="This section is expanded by default"
        defaultExpanded={true}
        isExpanded={expandedSections.has('default-expanded')}
        onToggle={handleToggle}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This section uses the defaultExpanded prop to be open on first render.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  );
};

/**
 * Usage in IssueDetailPage:
 *
 * ```tsx
 * const [expandedSections, setExpandedSections] = useState<Set<string>>(
 *   new Set(['engagement', 'audience']) // First 2 sections expanded by default
 * );
 *
 * const handleToggle = (sectionId: string) => {
 *   setExpandedSections((prev) => {
 *     const next = new Set(prev);
 *     if (next.has(sectionId)) {
 *       next.delete(sectionId);
 *     } else {
 *       next.add(sectionId);
 *     }
 *     return next;
 *   });
 * };
 *
 * return (
 *   <div>
 *     <CollapsibleSection
 *       id="engagement"
 *       title="Engagement Analytics"
 *       description="Link performance, geographic distribution, and engagement over time"
 *       icon={<TrendingUp className="h-5 w-5" />}
 *       isExpanded={expandedSections.has('engagement')}
 *       onToggle={handleToggle}
 *       badge={analytics?.links?.length}
 *     >
 *       <LinkPerformanceTable links={analytics.links} />
 *       <GeoMap geoDistribution={analytics.geoDistribution} />
 *     </CollapsibleSection>
 *   </div>
 * );
 * ```
 *
 * Session Storage:
 * - The component automatically saves expanded/collapsed state to sessionStorage
 * - State is preserved across page navigations within the same session
 * - Storage key: &apos;issue-detail-expanded-sections&apos;
 * - Stored as JSON array of section IDs: [&quot;engagement&quot;, &quot;audience&quot;]
 *
 * Accessibility:
 * - Keyboard accessible (Enter/Space to toggle)
 * - Proper ARIA attributes (aria-expanded, aria-controls, aria-hidden)
 * - Semantic HTML (section, h2)
 * - Screen reader friendly
 *
 * Animation:
 * - Smooth expand/collapse with max-height transition (300ms)
 * - Rotating chevron icon
 * - Hover effects on header
 * - Opacity fade for content
 */
