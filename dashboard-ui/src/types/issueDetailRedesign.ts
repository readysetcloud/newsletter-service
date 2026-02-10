/**
 * TypeScript interfaces for Issue Detail Page redesign components
 */

import type {
  InsightV2,
  IssueMetrics,
  BounceReasons,
  ComplaintDetail,
} from './issues';
import type { ComparisonResult } from '../utils/issueDetailUtils';

/**
 * Props for InsightsHeroSection component
 */
export interface InsightsHeroSectionProps {
  insights: InsightV2[];
  onRefreshInsights?: () => void;
  isRefreshing?: boolean;
}

/**
 * Props for KeyMetricsSummary component
 */
export interface KeyMetricsSummaryProps {
  metrics: {
    deliveries: number;
    openRate: number;
    clickRate: number;
    bounceRate: number;
    complaintRate: number;
  };
  comparisons?: {
    average?: IssueMetrics;
    lastIssue?: IssueMetrics;
    bestIssue?: IssueMetrics;
  };
  highlightMode?: 'average' | 'last' | 'best';
}

/**
 * Props for CollapsibleSection component
 */
export interface CollapsibleSectionProps {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  defaultExpanded?: boolean;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  badge?: string | number;
  isEmpty?: boolean;
  emptyMessage?: string;
}

/**
 * Navigation section configuration
 */
export interface NavigationSection {
  id: string;
  label: string;
  icon?: React.ReactNode;
  hasData: boolean;
}

/**
 * Props for QuickNavigation component
 */
export interface QuickNavigationProps {
  sections: NavigationSection[];
  activeSection: string | null;
  onSectionClick: (sectionId: string) => void;
  isSticky: boolean;
}

/**
 * Props for DeliverabilityHealthCard component
 */
export interface DeliverabilityHealthCardProps {
  bounceRate: number;
  complaintRate: number;
  bounceReasons?: BounceReasons;
  complaintDetails?: ComplaintDetail[];
  overallHealth: 'excellent' | 'good' | 'warning' | 'critical';
}

/**
 * Section configuration for the redesigned page
 */
export interface SectionConfig {
  id: string;
  title: string;
  description: string;
  icon: string;
  order: number;
  defaultExpanded: boolean;
  requiredData: string[];
  mobileOrder?: number;
}

/**
 * User preferences for issue detail page
 */
export interface IssueDetailPreferences {
  expandedSections: string[];
  defaultComparison: 'average' | 'last' | 'best';
  showPercentages: boolean;
  chartStyle?: 'line' | 'bar' | 'area';
}

/**
 * Page state for the redesigned issue detail page
 */
export interface IssueDetailPageState {
  expandedSections: Set<string>;
  stickyNavVisible: boolean;
  activeSection: string | null;
  userPreferences: IssueDetailPreferences;
}

/**
 * Props for PerformanceComparisonSection component
 */
export interface PerformanceComparisonSectionProps {
  current: IssueMetrics;
  average?: IssueMetrics;
  lastIssue?: IssueMetrics;
  bestIssue?: IssueMetrics;
  selectedComparison: 'average' | 'last' | 'best';
  onComparisonChange: (comparison: 'average' | 'last' | 'best') => void;
}

/**
 * Comparison card data
 */
export interface ComparisonCardData {
  type: 'average' | 'last' | 'best';
  label: string;
  metrics: IssueMetrics;
  comparisons: {
    openRate: ComparisonResult;
    clickRate: ComparisonResult;
    bounceRate: ComparisonResult;
  };
}

/**
 * Props for enhanced LinkPerformanceTable component
 */
export interface EnhancedLinkPerformanceTableProps {
  links: Array<{
    url: string;
    clicks: number;
    percentOfTotal: number;
    position: number;
    geoDistribution?: Array<{
      country: string;
      clicks: number;
    }>;
  }>;
  totalClicks: number;
  onLinkSelect?: (linkId: string) => void;
  selectedLinkId?: string | null;
}

/**
 * Props for TopCountriesList component
 */
export interface TopCountriesListProps {
  geoDistribution: Array<{
    country: string;
    clicks: number;
    opens: number;
    uniqueUsers?: number;
  }>;
  limit?: number;
  onCountryClick?: (country: string) => void;
  selectedCountry?: string | null;
}

/**
 * Props for enhanced GeoMap component
 */
export interface EnhancedGeoMapProps {
  geoDistribution: Array<{
    country: string;
    clicks: number;
    opens: number;
    uniqueClickUsers?: number;
    uniqueOpenUsers?: number;
  }>;
  linkAnalytics?: Array<{
    linkId: string;
    url: string;
    totalClicks: number;
    geoDistribution: Array<{
      country: string;
      clicks: number;
    }>;
  }>;
  selectedLinkId?: string | null;
  metricType?: 'clicks' | 'opens';
  onMetricTypeChange?: (type: 'clicks' | 'opens') => void;
  className?: string;
}

/**
 * Props for enhanced DecayChart components
 */
export interface EnhancedDecayChartProps {
  decayData: Array<{
    hour: number;
    value: number;
    cumulativeValue: number;
  }>;
  metricLabel: string;
  peakHour?: number;
  medianValue?: number;
  percentiles?: {
    p25: number;
    p75: number;
  };
}

/**
 * Props for enhanced TimingMetricsChart component
 */
export interface EnhancedTimingMetricsChartProps {
  timingMetrics: {
    medianTimeToOpen: number;
    p95TimeToOpen: number;
    medianTimeToClick: number;
    p95TimeToClick: number;
  };
  showIndustryBenchmark?: boolean;
  industryBenchmark?: {
    medianTimeToOpen: number;
    medianTimeToClick: number;
  };
}

/**
 * Health indicator configuration
 */
export interface HealthIndicatorConfig {
  status: 'excellent' | 'good' | 'warning' | 'critical';
  label: string;
  color: string;
  icon: string;
  description: string;
}

/**
 * Metric card configuration
 */
export interface MetricCardConfig {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  icon?: React.ReactNode;
  color: string;
  comparison?: ComparisonResult;
  tooltip?: string;
}

/**
 * Section visibility map
 */
export type SectionVisibility = Record<string, boolean>;

/**
 * Analytics loading state
 */
export interface AnalyticsLoadingState {
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;
}

/**
 * Scroll position state
 */
export interface ScrollPositionState {
  position: number;
  timestamp: number;
}
