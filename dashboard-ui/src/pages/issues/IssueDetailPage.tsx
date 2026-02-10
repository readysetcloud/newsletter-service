import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash, RefreshCw, AlertCircle, TrendingUp, Users, Shield, FileText } from 'lucide-react';
import { AppHeader } from '../../components/layout/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { IssueStatusBadge } from '../../components/issues/IssueStatusBadge';
import { MarkdownPreview } from '../../components/issues/MarkdownPreview';
import { DeleteIssueDialog } from '../../components/issues/DeleteIssueDialog';
import {
  IssueDetailSkeleton,
  InsightsHeroSkeleton,
  KeyMetricsSummarySkeleton,
  QuickNavigationSkeleton,
  DeliverabilityHealthSkeleton,
  GeoMapSkeleton,
  LinkPerformanceSkeleton,
  DecayChartSkeleton,
  ComparisonCardSkeleton,
  ChartSkeleton
} from '../../components/ui/SkeletonLoader';
import { MaxMindAttribution } from '../../components/analytics';
import { InsightsHeroSection } from '../../components/issues/InsightsHeroSection';
import { KeyMetricsSummary } from '../../components/issues/KeyMetricsSummary';
import { QuickNavigation } from '../../components/issues/QuickNavigation';
import { CollapsibleSection } from '../../components/issues/CollapsibleSection';
import { DeliverabilityHealthCard } from '../../components/issues/DeliverabilityHealthCard';
import { AsyncErrorBoundary } from '../../components/error/AsyncErrorBoundary';
import { FadeIn } from '../../components/ui/FadeIn';
import { issuesService } from '../../services/issuesService';
import { dashboardService } from '../../services/dashboardService';
import { calculateComplaintRate } from '../../utils/analyticsCalculations';
import {
  shouldShowSection,
  loadPreferences,
  updatePreference,
  saveScrollPosition,
  loadScrollPosition,
  clearScrollPosition,
  type UserPreferences
} from '../../utils/issueDetailUtils';
import { getErrorDetails, validateAnalyticsData } from '../../utils/errorMessages';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import type { Issue, IssueAnalytics, IssueMetrics, TrendsData } from '../../types/issues';
import type { NavigationSection } from '../../components/issues/QuickNavigation';

// Lazy load analytics components for better performance
const LinkPerformanceTable = lazy(() => import('../../components/issues/LinkPerformanceTable').then(m => ({ default: m.LinkPerformanceTable })));
const ClickDecayChart = lazy(() => import('../../components/issues/ClickDecayChart'));
const OpenDecayChart = lazy(() => import('../../components/issues/OpenDecayChart'));
const AudienceInsightsPanel = lazy(() => import('../../components/issues/AudienceInsightsPanel').then(m => ({ default: m.AudienceInsightsPanel })));
const ComplaintDetailsTable = lazy(() => import('../../components/issues/ComplaintDetailsTable').then(m => ({ default: m.ComplaintDetailsTable })));
const BounceReasonsChart = lazy(() => import('../../components/issues/BounceReasonsChart').then(m => ({ default: m.BounceReasonsChart })));
const EngagementTypeIndicator = lazy(() => import('../../components/issues/EngagementTypeIndicator').then(m => ({ default: m.EngagementTypeIndicator })));
const IssueComparisonCard = lazy(() => import('../../components/issues/IssueComparisonCard').then(m => ({ default: m.IssueComparisonCard })));
const TrafficSourceChart = lazy(() => import('../../components/issues/TrafficSourceChart').then(m => ({ default: m.TrafficSourceChart })));
const TimingMetricsChart = lazy(() => import('../../components/issues/TimingMetricsChart').then(m => ({ default: m.TimingMetricsChart })));
const GeoMap = lazy(() => import('../../components/analytics/GeoMap').then(m => ({ default: m.GeoMap })));
const LinkSelector = lazy(() => import('../../components/analytics/LinkSelector').then(m => ({ default: m.LinkSelector })));

// Section configuration for the new single-page layout
interface SectionConfig {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  order: number;
  defaultExpanded: boolean;
  requiredData: string[];
}

const SECTION_CONFIGS: SectionConfig[] = [
  {
    id: 'engagement',
    title: 'Engagement Analytics',
    description: 'Link performance, geographic distribution, and engagement over time',
    icon: <TrendingUp className="w-5 h-5" />,
    order: 1,
    defaultExpanded: true,
    requiredData: ['analytics.links', 'analytics.clickDecay', 'analytics.openDecay', 'analytics.trafficSource'],
  },
  {
    id: 'audience',
    title: 'Audience Insights',
    description: 'Device breakdown, geography, and engagement timing',
    icon: <Users className="w-5 h-5" />,
    order: 2,
    defaultExpanded: true,
    requiredData: ['analytics.deviceBreakdown', 'analytics.geoDistribution', 'analytics.timingMetrics'],
  },
  {
    id: 'deliverability',
    title: 'Deliverability & Quality',
    description: 'Bounce analysis, complaints, and quality signals',
    icon: <Shield className="w-5 h-5" />,
    order: 3,
    defaultExpanded: false,
    requiredData: ['analytics.bounceReasons', 'analytics.complaintDetails', 'analytics.engagementType'],
  },
];

export const IssueDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Core data state
  const [issue, setIssue] = useState<Issue | null>(null);
  const [analytics, setAnalytics] = useState<IssueAnalytics | null>(null);
  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [isAnalyticsRebuilding, setIsAnalyticsRebuilding] = useState(false);

  // New state for single-page layout
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [stickyNavVisible, setStickyNavVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState<'average' | 'last' | 'best'>('average');
  const [userPreferences] = useState<UserPreferences['issueDetail']>(() => loadPreferences());

  // Ref for skip link target
  const mainContentRef = useRef<HTMLElement>(null);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: 'Escape',
      handler: () => {
        // Close delete dialog if open
        if (deleteDialogOpen) {
          setDeleteDialogOpen(false);
        }
      },
      description: 'Close dialogs',
    },
    {
      key: 'b',
      handler: () => {
        handleBack();
      },
      description: 'Go back to issues list',
    },
    {
      key: 'r',
      handler: () => {
        if (isPublished && !isAnalyticsRebuilding) {
          handleRebuildAnalytics();
        }
      },
      description: 'Refresh analytics',
    },
    {
      key: 'e',
      handler: () => {
        if (isDraft) {
          handleEdit();
        }
      },
      description: 'Edit issue (draft only)',
    },
  ], !loading && !error);

  const loadIssue = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      // Priority 1: Load issue details first (critical content)
      const issueResponse = await issuesService.getIssue(id);

      if (issueResponse.success && issueResponse.data) {
        setIssue(issueResponse.data);

        // Extract analytics data if available (backward compatibility)
        if (issueResponse.data.stats?.analytics) {
          // Validate analytics data before setting
          const validation = validateAnalyticsData(issueResponse.data.stats.analytics);
          if (validation.isValid) {
            setAnalytics(issueResponse.data.stats.analytics);
          } else {
            console.warn('Analytics data validation failed:', validation.errors);
            setAnalytics(null);
          }
        } else {
          setAnalytics(null);
        }

        // Priority 2: Load trends data in background (for comparisons)
        // This is deferred and doesn't block the initial render
        // Use requestIdleCallback if available to avoid blocking main thread
        const loadTrends = () => {
          dashboardService.getTrends(20).then(trendsResponse => {
            if (trendsResponse.success && trendsResponse.data) {
              setTrendsData(trendsResponse.data);
            }
          }).catch(err => {
            console.warn('Failed to load trends data:', err);
            // Don't set error state - trends are optional
          });
        };

        if ('requestIdleCallback' in window) {
          requestIdleCallback(loadTrends);
        } else {
          setTimeout(loadTrends, 100);
        }
      } else {
        const errorDetails = getErrorDetails(issueResponse.error || 'Failed to load issue');
        setError(errorDetails.message);
      }
    } catch (err) {
      console.error('Error loading issue:', err);
      const errorDetails = getErrorDetails(err instanceof Error ? err : 'Failed to load issue');
      setError(errorDetails.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      loadIssue();
    }
  }, [id, loadIssue]);

  // Restore scroll position when returning to the page
  useEffect(() => {
    if (!loading && issue && id) {
      const savedPosition = loadScrollPosition(id);
      if (savedPosition !== null) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          window.scrollTo({
            top: savedPosition,
            behavior: 'auto', // Use 'auto' for instant restoration
          });
        });
      }
    }
  }, [loading, issue, id]);

  // Save scroll position before navigation
  useEffect(() => {
    if (!id) return;

    const handleScroll = () => {
      const position = window.pageYOffset || document.documentElement.scrollTop;
      saveScrollPosition(id, position);
    };

    // Throttle scroll events to avoid excessive saves
    let scrollTimeout: NodeJS.Timeout;
    const throttledHandleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = setTimeout(handleScroll, 100);
    };

    window.addEventListener('scroll', throttledHandleScroll, { passive: true });

    // Save scroll position before unmount (navigation away)
    return () => {
      window.removeEventListener('scroll', throttledHandleScroll);
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      // Save final position on unmount
      handleScroll();
    };
  }, [id]);

  // Initialize expanded sections based on screen size, defaults, and user preferences
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    const defaultExpanded = new Set<string>();

    // Load user preferences for expanded sections
    const savedExpandedSections = userPreferences.expandedSections;

    if (savedExpandedSections.length > 0) {
      // Use saved preferences if available
      savedExpandedSections.forEach(sectionId => defaultExpanded.add(sectionId));
    } else if (!isMobile) {
      // On desktop, expand first 2 sections by default if no preferences
      SECTION_CONFIGS
        .filter(config => config.defaultExpanded)
        .slice(0, 2)
        .forEach(config => defaultExpanded.add(config.id));
    }
    // On mobile, all sections collapsed by default

    setExpandedSections(defaultExpanded);

    // Load comparison mode preference
    setComparisonMode(userPreferences.defaultComparison);

    // Handle window resize to adjust section states
    const handleResize = () => {
      const isNowMobile = window.innerWidth < 768;
      if (isNowMobile && expandedSections.size > 0) {
        // Collapse all sections when switching to mobile
        setExpandedSections(new Set());
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Intersection Observer for sticky navigation and active section tracking
  useEffect(() => {
    const keyMetricsElement = document.getElementById('key-metrics-summary');
    const sectionElements = SECTION_CONFIGS.map(config =>
      document.getElementById(`section-${config.id}`)
    ).filter(Boolean);

    // Observer for sticky navigation trigger
    const stickyObserver = new IntersectionObserver(
      ([entry]) => {
        setStickyNavVisible(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: '-100px 0px 0px 0px' }
    );

    if (keyMetricsElement) {
      stickyObserver.observe(keyMetricsElement);
    }

    // Observer for active section tracking
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const sectionId = entry.target.id.replace('section-', '');
            setActiveSection(sectionId);
          }
        });
      },
      { threshold: 0.5, rootMargin: '-100px 0px -50% 0px' }
    );

    sectionElements.forEach(element => {
      if (element) sectionObserver.observe(element);
    });

    return () => {
      if (keyMetricsElement) stickyObserver.unobserve(keyMetricsElement);
      sectionElements.forEach(element => {
        if (element) sectionObserver.unobserve(element);
      });
    };
  }, [issue, analytics]);

  // Handler for section toggle
  const handleSectionToggle = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }

      // Save expanded sections to preferences
      const expandedArray = Array.from(newSet);
      updatePreference('expandedSections', expandedArray);

      return newSet;
    });
  }, []);

  // Handler for navigation click with smooth scrolling
  const handleNavigationClick = useCallback((sectionId: string) => {
    const element = document.getElementById(`section-${sectionId}`);
    if (element) {
      const offset = 100; // Account for sticky header
      const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });

      // Expand the section if it's collapsed
      setExpandedSections(prev => {
        const newSet = new Set(prev);
        newSet.add(sectionId);
        return newSet;
      });
    }
  }, []);

  const handleRebuildAnalytics = useCallback(async () => {
    if (!id) return;

    try {
      setIsAnalyticsRebuilding(true);
      const response = await issuesService.rebuildAnalytics(id);

      if (response.success) {
        addToast({
          type: 'success',
          title: 'Insights refresh queued',
          message: 'We’ll process analytics for this issue shortly.',
        });
      } else {
        addToast({
          type: 'error',
          title: 'Failed to refresh insights',
          message: response.error || 'Could not queue analytics rebuild.',
        });
      }
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to refresh insights',
        message: err instanceof Error ? err.message : 'Could not queue analytics rebuild.',
      });
    } finally {
      setIsAnalyticsRebuilding(false);
    }
  }, [id, addToast]);

  const handleDelete = useCallback(async () => {
    if (!issue) return;

    try {
      const response = await issuesService.deleteIssue(issue.id);

      if (response.success) {
        navigate('/issues', { state: { message: 'Issue deleted successfully' } });
      } else {
        const errorDetails = getErrorDetails(response.error || 'Failed to delete issue');
        setError(errorDetails.message);
        setDeleteDialogOpen(false);
      }
    } catch (err) {
      console.error('Error deleting issue:', err);
      const errorDetails = getErrorDetails(err instanceof Error ? err : 'Failed to delete issue');
      setError(errorDetails.message);
      setDeleteDialogOpen(false);
    }
  }, [issue, navigate]);

  const handleEdit = useCallback(() => {
    if (issue) {
      navigate(`/issues/${issue.id}/edit`);
    }
  }, [issue, navigate]);

  const handleBack = useCallback(() => {
    // Clear scroll position when intentionally navigating away
    clearScrollPosition();
    navigate('/issues');
  }, [navigate]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isDraft = useMemo(() => issue?.status === 'draft', [issue?.status]);
  const isPublished = useMemo(() => issue?.status === 'published', [issue?.status]);

  const complaintRate = useMemo(() => {
    if (!issue?.stats) return 0;
    return calculateComplaintRate(issue.stats.complaints, issue.stats.deliveries);
  }, [issue?.stats]);

  const currentMetrics = useMemo<IssueMetrics | null>(() => {
    if (!issue?.stats) return null;

    return {
      openRate: issue.stats.deliveries > 0 ? (issue.stats.opens / issue.stats.deliveries) * 100 : 0,
      clickRate: issue.stats.deliveries > 0 ? (issue.stats.clicks / issue.stats.deliveries) * 100 : 0,
      bounceRate: issue.stats.deliveries > 0 ? (issue.stats.bounces / issue.stats.deliveries) * 100 : 0,
      delivered: issue.stats.deliveries,
      opens: issue.stats.opens,
      clicks: issue.stats.clicks,
      bounces: issue.stats.bounces,
      complaints: issue.stats.complaints,
      subscribers: issue.stats.subscribers,
    };
  }, [issue]);

  const averageMetrics = useMemo<IssueMetrics | null>(() => {
    if (!trendsData?.aggregates) return null;
    const issueCount = trendsData.issues.length || 1;
    const avgSubscribers = trendsData.issues.reduce((sum, i) => sum + i.metrics.subscribers, 0) / issueCount;

    return {
      openRate: trendsData.aggregates.avgOpenRate,
      clickRate: trendsData.aggregates.avgClickRate,
      bounceRate: trendsData.aggregates.avgBounceRate,
      delivered: trendsData.aggregates.totalDelivered / trendsData.aggregates.issueCount,
      opens: 0,
      clicks: 0,
      bounces: 0,
      complaints: 0,
      subscribers: Math.round(avgSubscribers),
    };
  }, [trendsData]);

  const lastIssueMetrics = useMemo<IssueMetrics | null>(() => {
    if (!trendsData?.issues || trendsData.issues.length < 2) return null;

    const sortedIssues = [...trendsData.issues].sort((a, b) => {
      const aId = parseInt(a.id);
      const bId = parseInt(b.id);
      return bId - aId;
    });

    const currentIssueIndex = sortedIssues.findIndex(i => i.id === id);
    if (currentIssueIndex === -1 || currentIssueIndex === sortedIssues.length - 1) return null;

    return sortedIssues[currentIssueIndex + 1].metrics;
  }, [trendsData, id]);

  // Calculate section visibility and navigation items
  const navigationSections = useMemo<NavigationSection[]>(() => {
    if (!isPublished || !analytics) return [];

    return SECTION_CONFIGS
      .filter(config => shouldShowSection(config.id, analytics, issue?.stats))
      .map(config => ({
        id: config.id,
        label: config.title,
        icon: config.icon,
        hasData: true,
      }));
  }, [isPublished, analytics, issue?.stats]);

  // Calculate metrics for KeyMetricsSummary
  const keyMetrics = useMemo(() => {
    if (!issue?.stats) return null;

    return {
      deliveries: issue.stats.deliveries,
      openRate: issue.stats.deliveries > 0 ? (issue.stats.opens / issue.stats.deliveries) * 100 : 0,
      clickRate: issue.stats.deliveries > 0 ? (issue.stats.clicks / issue.stats.deliveries) * 100 : 0,
      bounceRate: issue.stats.deliveries > 0 ? (issue.stats.bounces / issue.stats.deliveries) * 100 : 0,
      complaintRate: complaintRate,
    };
  }, [issue?.stats, complaintRate]);

  const bestIssueMetrics = useMemo<IssueMetrics | null>(() => {
    if (!trendsData?.issues || trendsData.issues.length === 0) return null;

    const bestIssue = trendsData.issues.reduce((best, current) => {
      const currentScore = current.metrics.openRate + current.metrics.clickRate;
      const bestScore = best.metrics.openRate + best.metrics.clickRate;
      return currentScore > bestScore ? current : best;
    });

    return bestIssue.metrics;
  }, [trendsData]);

  const comparisons = useMemo(() => {
    if (!averageMetrics && !lastIssueMetrics && !bestIssueMetrics) return undefined;

    return {
      average: averageMetrics || undefined,
      lastIssue: lastIssueMetrics || undefined,
      bestIssue: bestIssueMetrics || undefined,
    };
  }, [averageMetrics, lastIssueMetrics, bestIssueMetrics]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div role="status" aria-live="polite" aria-label="Loading issue details">
            <span className="sr-only">Loading issue details...</span>
            {/* Back Button Skeleton */}
            <div className="mb-6">
              <div className="h-9 w-32 bg-muted rounded animate-pulse" />
            </div>
            <IssueDetailSkeleton />
          </div>
        </main>
      </div>
    );
  }

  if (error || !issue) {
    const errorDetails = error ? getErrorDetails(error) : getErrorDetails('Issue not found');

    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="py-12">
              <div role="alert" aria-live="assertive" className="text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-error-400 mb-4" aria-hidden="true" />
                <h2 className="text-2xl font-semibold text-foreground mb-2">
                  {errorDetails.title}
                </h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  {errorDetails.message}
                </p>
                <div className="flex justify-center gap-3">
                  {errorDetails.showBackButton && (
                    <Button onClick={handleBack} variant="outline" aria-label="Back to issues list">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Issues
                    </Button>
                  )}
                  {errorDetails.showRetry && (
                    <Button onClick={loadIssue} aria-label="Retry loading issue">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Try Again
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Skip to main content link for keyboard navigation */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary-600 focus:text-white focus:rounded focus:shadow-lg"
        onClick={(e) => {
          e.preventDefault();
          mainContentRef.current?.focus();
          mainContentRef.current?.scrollIntoView({ behavior: 'smooth' });
        }}
      >
        Skip to main content
      </a>

      {/* Live region for dynamic updates (screen readers) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {isAnalyticsRebuilding && 'Refreshing analytics insights...'}
        {loading && 'Loading issue details...'}
      </div>

      <AppHeader />

      <main
        id="main-content"
        ref={mainContentRef}
        tabIndex={-1}
        className="max-w-7xl 2xl:max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-8 focus:outline-none"
      >
        {/* Back Button */}
        <div className="mb-4 sm:mb-6">
          <Button onClick={handleBack} variant="ghost" size="sm" aria-label="Back to issues list" className="min-h-[44px] min-w-[44px]">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Issues
          </Button>
        </div>

        {/* Issue Header */}
        <Card className="mb-4 sm:mb-6 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground break-words">{issue.subject}</h1>
                  <IssueStatusBadge status={issue.status} />
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
                  <span className="font-medium">Issue #{issue.issueNumber}</span>
                  <span className="hidden sm:inline">•</span>
                  <span>Created {formatDate(issue.createdAt)}</span>
                  {issue.publishedAt && (
                    <>
                      <span className="hidden sm:inline">•</span>
                      <span className="text-success-600 dark:text-success-400 font-medium">Published {formatDate(issue.publishedAt)}</span>
                    </>
                  )}
                  {issue.scheduledAt && !issue.publishedAt && (
                    <>
                      <span className="hidden sm:inline">•</span>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">Scheduled for {formatDate(issue.scheduledAt)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                {isPublished && (
                  <Button
                    onClick={handleRebuildAnalytics}
                    variant="outline"
                    size="sm"
                    aria-label="Refresh analytics insights"
                    disabled={isAnalyticsRebuilding}
                    className="min-h-[44px] min-w-[44px]"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">{isAnalyticsRebuilding ? 'Queuing…' : 'Refresh insights'}</span>
                    <span className="sm:hidden">{isAnalyticsRebuilding ? 'Queuing…' : 'Refresh'}</span>
                  </Button>
                )}
                {isDraft && (
                  <>
                    <Button
                      onClick={handleEdit}
                      variant="outline"
                      size="sm"
                      aria-label="Edit this issue"
                      className="hover:bg-primary-50 hover:border-primary-300 dark:hover:bg-primary-900/20 transition-colors min-h-[44px] min-w-[44px]"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button
                      onClick={() => setDeleteDialogOpen(true)}
                      variant="destructive"
                      size="sm"
                      aria-label="Delete this issue"
                      className="hover:bg-error-700 transition-colors min-h-[44px] min-w-[44px]"
                    >
                      <Trash className="h-4 w-4 mr-2" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* InsightsHeroSection - Show at top if insights exist */}
        {isPublished && issue.insightsV2 && issue.insightsV2.length > 0 && (
          <div className="mb-4 sm:mb-6">
            <Suspense fallback={<InsightsHeroSkeleton />}>
              <FadeIn variant="slideUp" speed="normal">
                <AsyncErrorBoundary onRetry={loadIssue}>
                  <InsightsHeroSection
                    insights={issue.insightsV2}
                    onRefreshInsights={handleRebuildAnalytics}
                    isRefreshing={isAnalyticsRebuilding}
                  />
                </AsyncErrorBoundary>
              </FadeIn>
            </Suspense>
          </div>
        )}

        {/* KeyMetricsSummary - Show after insights */}
        {isPublished && keyMetrics && (
          <div id="key-metrics-summary" className="mb-4 sm:mb-6">
            <Suspense fallback={<KeyMetricsSummarySkeleton />}>
              <FadeIn variant="slideUp" speed="normal" delay={100}>
                <AsyncErrorBoundary onRetry={loadIssue}>
                  <KeyMetricsSummary
                    metrics={keyMetrics}
                    comparisons={comparisons}
                    highlightMode={comparisonMode}
                  />
                </AsyncErrorBoundary>
              </FadeIn>
            </Suspense>
          </div>
        )}

        {/* QuickNavigation - Becomes sticky on scroll */}
        {isPublished && navigationSections.length > 0 && (
          <Suspense fallback={<QuickNavigationSkeleton />}>
            <QuickNavigation
              sections={navigationSections}
              activeSection={activeSection}
              onSectionClick={handleNavigationClick}
              isSticky={stickyNavVisible}
              className="mb-4 sm:mb-6"
            />
          </Suspense>
        )}

        {/* PerformanceComparisonSection */}
        {isPublished && currentMetrics && (
          <div className="mb-4 sm:mb-6">
            <Suspense fallback={<ComparisonCardSkeleton />}>
              <FadeIn variant="fade" speed="normal">
                <AsyncErrorBoundary onRetry={loadIssue}>
                  <IssueComparisonCard
                    current={currentMetrics}
                    average={averageMetrics || undefined}
                    lastIssue={lastIssueMetrics || undefined}
                    bestIssue={bestIssueMetrics || undefined}
                  />
                </AsyncErrorBoundary>
              </FadeIn>
            </Suspense>
          </div>
        )}

        {/* Analytics Pending Banner */}
        {isPublished && issue.stats && !issue.stats.analytics && (
          <Card className="shadow-sm mb-4 sm:mb-6 border-l-4 border-l-amber-500">
            <CardHeader className="bg-muted/30 p-3 sm:p-6">
              <CardTitle className="text-base sm:text-xl">Analytics Processing</CardTitle>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Analytics can take a few minutes to appear after publish.
              </p>
            </CardHeader>
            <CardContent className="pt-4 sm:pt-6 p-3 sm:p-6">
              <div className="text-sm text-muted-foreground">
                Refresh this page in a few minutes to see the latest analytics.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Engagement Analytics Section */}
        {isPublished && analytics && shouldShowSection('engagement', analytics, issue?.stats) && (
          <CollapsibleSection
            id="section-engagement"
            title="Engagement Analytics"
            description="Link performance, geographic distribution, and engagement over time"
            icon={<TrendingUp className="w-5 h-5" />}
            isExpanded={expandedSections.has('engagement')}
            onToggle={handleSectionToggle}
            badge={analytics.links?.length || undefined}
          >
            <div className="space-y-6">
              {/* Geographic Analytics Map */}
              {analytics.geoDistribution && analytics.geoDistribution.length > 0 && (
                <section aria-labelledby="geographic-analytics-heading">
                  <h3 id="geographic-analytics-heading" className="text-lg font-semibold text-foreground mb-4">Geographic Analytics</h3>
                  <Suspense fallback={<GeoMapSkeleton />}>
                    <FadeIn variant="fade" speed="normal">
                      <AsyncErrorBoundary onRetry={loadIssue}>
                        <div className="space-y-4">
                          {analytics.links && analytics.links.length > 0 && (
                            <LinkSelector
                              links={analytics.links.map(link => ({
                                id: link.url,
                                url: link.url,
                                totalClicks: link.clicks
                              }))}
                              selectedLinkId={selectedLinkId}
                              onLinkSelect={setSelectedLinkId}
                            />
                          )}
                          <GeoMap
                            geoDistribution={analytics.geoDistribution}
                            linkAnalytics={analytics.links.map(link => ({
                              linkId: link.url,
                              url: link.url,
                              totalClicks: link.clicks,
                              geoDistribution: link.geoDistribution || []
                            }))}
                            selectedLinkId={selectedLinkId}
                            className="w-full"
                          />
                        </div>
                      </AsyncErrorBoundary>
                    </FadeIn>
                  </Suspense>
                  <MaxMindAttribution />
                </section>
              )}

              {/* Link Performance */}
              {analytics.links && analytics.links.length > 0 && (
                <section aria-labelledby="link-performance-heading">
                  <h3 id="link-performance-heading" className="text-lg font-semibold text-foreground mb-4">Link Performance</h3>
                  <Suspense fallback={<LinkPerformanceSkeleton />}>
                    <FadeIn variant="fade" speed="normal">
                      <AsyncErrorBoundary onRetry={loadIssue}>
                        <LinkPerformanceTable
                          links={analytics.links}
                          totalClicks={issue.stats?.clicks || 0}
                        />
                      </AsyncErrorBoundary>
                    </FadeIn>
                  </Suspense>
                </section>
              )}

              {/* Traffic Sources */}
              {analytics.trafficSource && (
                <section aria-labelledby="traffic-sources-heading">
                  <h3 id="traffic-sources-heading" className="text-lg font-semibold text-foreground mb-4">Traffic Sources</h3>
                  <Suspense fallback={<ChartSkeleton />}>
                    <FadeIn variant="fade" speed="normal">
                      <AsyncErrorBoundary onRetry={loadIssue}>
                        <TrafficSourceChart trafficSource={analytics.trafficSource} />
                      </AsyncErrorBoundary>
                    </FadeIn>
                  </Suspense>
                </section>
              )}

              {/* Click Decay Chart */}
              {analytics.clickDecay && analytics.clickDecay.length > 0 && (
                <section aria-labelledby="click-activity-heading">
                  <h3 id="click-activity-heading" className="text-lg font-semibold text-foreground mb-4">Click Activity Over Time</h3>
                  <Suspense fallback={<DecayChartSkeleton />}>
                    <FadeIn variant="fade" speed="normal">
                      <AsyncErrorBoundary onRetry={loadIssue}>
                        <ClickDecayChart clickDecay={analytics.clickDecay} />
                      </AsyncErrorBoundary>
                    </FadeIn>
                  </Suspense>
                </section>
              )}

              {/* Open Decay Chart */}
              {analytics.openDecay && analytics.openDecay.length > 0 && (
                <section aria-labelledby="open-activity-heading">
                  <h3 id="open-activity-heading" className="text-lg font-semibold text-foreground mb-4">Open Activity Over Time</h3>
                  <Suspense fallback={<DecayChartSkeleton />}>
                    <FadeIn variant="fade" speed="normal">
                      <AsyncErrorBoundary onRetry={loadIssue}>
                        <OpenDecayChart openDecay={analytics.openDecay} />
                      </AsyncErrorBoundary>
                    </FadeIn>
                  </Suspense>
                </section>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Audience Insights Section */}
        {isPublished && analytics && shouldShowSection('audience', analytics, issue?.stats) && (
          <CollapsibleSection
            id="section-audience"
            title="Audience Insights"
            description="Device breakdown, geography, and engagement timing"
            icon={<Users className="w-5 h-5" />}
            isExpanded={expandedSections.has('audience')}
            onToggle={handleSectionToggle}
          >
            <div className="space-y-6">
              {/* Audience Insights Panel */}
              <section aria-labelledby="audience-overview-heading">
                <h3 id="audience-overview-heading" className="text-lg font-semibold text-foreground mb-4">Audience Overview</h3>
                <Suspense fallback={<ChartSkeleton />}>
                  <AsyncErrorBoundary onRetry={loadIssue}>
                    <AudienceInsightsPanel
                      geoDistribution={analytics.geoDistribution || []}
                      deviceBreakdown={analytics.deviceBreakdown || { desktop: 0, mobile: 0, tablet: 0 }}
                      timingMetrics={analytics.timingMetrics || { medianTimeToOpen: 0, p95TimeToOpen: 0, medianTimeToClick: 0, p95TimeToClick: 0 }}
                    />
                  </AsyncErrorBoundary>
                </Suspense>
                <MaxMindAttribution />
              </section>

              {/* Timing Metrics */}
              {analytics.timingMetrics && (
                <section aria-labelledby="timing-metrics-heading">
                  <h3 id="timing-metrics-heading" className="text-lg font-semibold text-foreground mb-4">Time to Engage</h3>
                  <Suspense fallback={<ChartSkeleton />}>
                    <AsyncErrorBoundary onRetry={loadIssue}>
                      <TimingMetricsChart timingMetrics={analytics.timingMetrics} />
                    </AsyncErrorBoundary>
                  </Suspense>
                </section>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Deliverability & Quality Section */}
        {isPublished && analytics && shouldShowSection('deliverability', analytics, issue?.stats) && (
          <CollapsibleSection
            id="section-deliverability"
            title="Deliverability & Quality"
            description="Bounce analysis, complaints, and quality signals"
            icon={<Shield className="w-5 h-5" />}
            isExpanded={expandedSections.has('deliverability')}
            onToggle={handleSectionToggle}
          >
            <div className="space-y-6">
              {/* Deliverability Health Card */}
              {issue.stats && (
                <Suspense fallback={<DeliverabilityHealthSkeleton />}>
                  <AsyncErrorBoundary onRetry={loadIssue}>
                    <DeliverabilityHealthCard
                      bounceRate={issue.stats.deliveries > 0 ? (issue.stats.bounces / issue.stats.deliveries) * 100 : 0}
                      complaintRate={complaintRate}
                      bounceReasons={analytics.bounceReasons}
                      complaintDetails={analytics.complaintDetails}
                    />
                  </AsyncErrorBoundary>
                </Suspense>
              )}

              {/* Engagement Type */}
              {analytics.engagementType && (
                <section aria-labelledby="engagement-type-heading">
                  <h3 id="engagement-type-heading" className="text-lg font-semibold text-foreground mb-4">Engagement Type</h3>
                  <Suspense fallback={<ChartSkeleton />}>
                    <AsyncErrorBoundary onRetry={loadIssue}>
                      <EngagementTypeIndicator
                        engagementType={analytics.engagementType}
                        totalClicks={issue.stats?.clicks || 0}
                      />
                    </AsyncErrorBoundary>
                  </Suspense>
                </section>
              )}

              {/* Bounce Reasons */}
              {analytics.bounceReasons && (
                <section aria-labelledby="bounce-reasons-heading">
                  <h3 id="bounce-reasons-heading" className="text-lg font-semibold text-foreground mb-4">Bounce Reasons</h3>
                  <Suspense fallback={<ChartSkeleton />}>
                    <AsyncErrorBoundary onRetry={loadIssue}>
                      <BounceReasonsChart bounceReasons={analytics.bounceReasons} />
                    </AsyncErrorBoundary>
                  </Suspense>
                </section>
              )}

              {/* Complaint Details */}
              {analytics.complaintDetails && analytics.complaintDetails.length > 0 && (
                <section aria-labelledby="complaint-details-heading">
                  <h3 id="complaint-details-heading" className="text-lg font-semibold text-foreground mb-4">Complaint Details</h3>
                  <Suspense fallback={<LinkPerformanceSkeleton />}>
                    <AsyncErrorBoundary onRetry={loadIssue}>
                      <ComplaintDetailsTable complaints={analytics.complaintDetails} />
                    </AsyncErrorBoundary>
                  </Suspense>
                </section>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Content Preview Section - Moved to bottom */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" aria-hidden="true" />
              Content
            </CardTitle>
          </CardHeader>
          <CardContent>
            <article aria-label="Issue content preview">
              <MarkdownPreview content={issue.content} />
            </article>
          </CardContent>
        </Card>

        {/* Audience Insights Section */}
        {isPublished && analytics && shouldShowSection('audience', analytics, issue?.stats) && (
          <CollapsibleSection
            id="audience"
            title="Audience Insights"
            description="Device breakdown, geography, and engagement timing"
            icon={<Users className="w-5 h-5" />}
            isExpanded={expandedSections.has('audience')}
            onToggle={handleSectionToggle}
          >
            <div className="space-y-6">
              {/* Audience Insights Panel */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Audience Overview</h3>
                <Suspense fallback={<div className="animate-pulse h-48 bg-muted rounded" />}>
                  <AudienceInsightsPanel
                    geoDistribution={analytics.geoDistribution || []}
                    deviceBreakdown={analytics.deviceBreakdown || { desktop: 0, mobile: 0, tablet: 0 }}
                    timingMetrics={analytics.timingMetrics || { medianTimeToOpen: 0, p95TimeToOpen: 0, medianTimeToClick: 0, p95TimeToClick: 0 }}
                  />
                </Suspense>
                <MaxMindAttribution />
              </div>

              {/* Timing Metrics */}
              {analytics.timingMetrics && (
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">Time to Engage</h3>
                  <Suspense fallback={<div className="animate-pulse h-48 bg-muted rounded" />}>
                    <TimingMetricsChart timingMetrics={analytics.timingMetrics} />
                  </Suspense>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Deliverability & Quality Section */}
        {isPublished && analytics && shouldShowSection('deliverability', analytics, issue?.stats) && (
          <CollapsibleSection
            id="deliverability"
            title="Deliverability & Quality"
            description="Bounce analysis, complaints, and quality signals"
            icon={<Shield className="w-5 h-5" />}
            isExpanded={expandedSections.has('deliverability')}
            onToggle={handleSectionToggle}
          >
            <div className="space-y-6">
              {/* Deliverability Health Card */}
              {issue.stats && (
                <DeliverabilityHealthCard
                  bounceRate={issue.stats.deliveries > 0 ? (issue.stats.bounces / issue.stats.deliveries) * 100 : 0}
                  complaintRate={complaintRate}
                  bounceReasons={analytics.bounceReasons}
                  complaintDetails={analytics.complaintDetails}
                />
              )}

              {/* Engagement Type */}
              {analytics.engagementType && (
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">Engagement Type</h3>
                  <Suspense fallback={<div className="animate-pulse h-24 bg-muted rounded" />}>
                    <EngagementTypeIndicator
                      engagementType={analytics.engagementType}
                      totalClicks={issue.stats?.clicks || 0}
                    />
                  </Suspense>
                </div>
              )}

              {/* Bounce Reasons */}
              {analytics.bounceReasons && (
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">Bounce Reasons</h3>
                  <Suspense fallback={<div className="animate-pulse h-48 bg-muted rounded" />}>
                    <BounceReasonsChart bounceReasons={analytics.bounceReasons} />
                  </Suspense>
                </div>
              )}

              {/* Complaint Details */}
              {analytics.complaintDetails && analytics.complaintDetails.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">Complaint Details</h3>
                  <Suspense fallback={<div className="animate-pulse h-32 bg-muted rounded" />}>
                    <ComplaintDetailsTable complaints={analytics.complaintDetails} />
                  </Suspense>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Content Preview Section - Moved to bottom */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Content
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MarkdownPreview content={issue.content} />
          </CardContent>
        </Card>

      </main>

      {/* Delete Confirmation Dialog */}
      <DeleteIssueDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        issue={issue}
      />
    </div>
  );
};
