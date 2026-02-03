import type {
  TrendsData,
  IssueStats,
  IssueAnalytics,
  TrendAggregates,
  IssueTrendItem,
  IssueMetrics,
  LinkPerformance,
  ClickDecayPoint,
  GeoData,
  DeviceBreakdown,
  TimingMetrics,
  EngagementType,
  BounceReasons,
  ComplaintDetail,
} from '@/types/issues';

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && value >= 0;
}

function isValidRate(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && value >= 0 && value <= 100;
}

export function validateIssueMetrics(data: unknown): data is IssueMetrics {
  if (!data || typeof data !== 'object') return false;
  const metrics = data as Record<string, unknown>;
  return (
    isValidRate(metrics.openRate) &&
    isValidRate(metrics.clickRate) &&
    isValidRate(metrics.bounceRate) &&
    isNonNegativeNumber(metrics.delivered) &&
    isNonNegativeNumber(metrics.opens) &&
    isNonNegativeNumber(metrics.clicks) &&
    isNonNegativeNumber(metrics.bounces) &&
    isNonNegativeNumber(metrics.complaints) &&
    isNonNegativeNumber(metrics.subscribers)
  );
}

export function validateTrendAggregates(data: unknown): data is TrendAggregates {
  if (!data || typeof data !== 'object') return false;
  const aggregates = data as Record<string, unknown>;
  return (
    isValidRate(aggregates.avgOpenRate) &&
    isValidRate(aggregates.avgClickRate) &&
    isValidRate(aggregates.avgBounceRate) &&
    isNonNegativeNumber(aggregates.totalDelivered) &&
    isNonNegativeNumber(aggregates.issueCount)
  );
}

export function validateIssueTrendItem(data: unknown): data is IssueTrendItem {
  if (!data || typeof data !== 'object') return false;
  const item = data as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    validateIssueMetrics(item.metrics)
  );
}

export function validateTrendsData(data: unknown): data is TrendsData {
  if (!data || typeof data !== 'object') {
    console.error('TrendsData validation failed: data is not an object');
    return false;
  }
  const trends = data as Record<string, unknown>;
  if (!Array.isArray(trends.issues)) {
    console.error('TrendsData validation failed: issues is not an array');
    return false;
  }
  if (!trends.issues.every(validateIssueTrendItem)) {
    console.error('TrendsData validation failed: invalid issue item');
    return false;
  }
  if (!validateTrendAggregates(trends.aggregates)) {
    console.error('TrendsData validation failed: invalid aggregates');
    return false;
  }
  if (trends.previousPeriodAggregates !== undefined && !validateTrendAggregates(trends.previousPeriodAggregates)) {
    console.error('TrendsData validation failed: invalid previousPeriodAggregates');
    return false;
  }
  return true;
}

export function validateLinkPerformance(data: unknown): data is LinkPerformance {
  if (!data || typeof data !== 'object') return false;
  const link = data as Record<string, unknown>;
  return (
    typeof link.url === 'string' &&
    link.url.length > 0 &&
    isNonNegativeNumber(link.clicks) &&
    isValidRate(link.percentOfTotal) &&
    typeof link.position === 'number' &&
    link.position >= 0
  );
}

export function validateClickDecayPoint(data: unknown): data is ClickDecayPoint {
  if (!data || typeof data !== 'object') return false;
  const point = data as Record<string, unknown>;
  return (
    typeof point.hour === 'number' &&
    point.hour >= 0 &&
    isNonNegativeNumber(point.clicks) &&
    isNonNegativeNumber(point.cumulativeClicks)
  );
}

export function validateGeoData(data: unknown): data is GeoData {
  if (!data || typeof data !== 'object') return false;
  const geo = data as Record<string, unknown>;
  return (
    typeof geo.country === 'string' &&
    geo.country.length > 0 &&
    isNonNegativeNumber(geo.clicks) &&
    isNonNegativeNumber(geo.opens)
  );
}

export function validateDeviceBreakdown(data: unknown): data is DeviceBreakdown {
  if (!data || typeof data !== 'object') return false;
  const device = data as Record<string, unknown>;
  return (
    isNonNegativeNumber(device.desktop) &&
    isNonNegativeNumber(device.mobile) &&
    isNonNegativeNumber(device.tablet)
  );
}

export function validateTimingMetrics(data: unknown): data is TimingMetrics {
  if (!data || typeof data !== 'object') return false;
  const timing = data as Record<string, unknown>;
  return (
    isNonNegativeNumber(timing.medianTimeToOpen) &&
    isNonNegativeNumber(timing.p95TimeToOpen) &&
    isNonNegativeNumber(timing.medianTimeToClick) &&
    isNonNegativeNumber(timing.p95TimeToClick)
  );
}

export function validateEngagementType(data: unknown): data is EngagementType {
  if (!data || typeof data !== 'object') return false;
  const engagement = data as Record<string, unknown>;
  return (
    isNonNegativeNumber(engagement.newClickers) &&
    isNonNegativeNumber(engagement.returningClickers)
  );
}

export function validateBounceReasons(data: unknown): data is BounceReasons {
  if (!data || typeof data !== 'object') return false;
  const bounce = data as Record<string, unknown>;
  return (
    isNonNegativeNumber(bounce.permanent) &&
    isNonNegativeNumber(bounce.temporary) &&
    isNonNegativeNumber(bounce.suppressed)
  );
}

export function validateComplaintDetail(data: unknown): data is ComplaintDetail {
  if (!data || typeof data !== 'object') return false;
  const complaint = data as Record<string, unknown>;
  return (
    typeof complaint.email === 'string' &&
    complaint.email.length > 0 &&
    typeof complaint.timestamp === 'string' &&
    complaint.timestamp.length > 0 &&
    typeof complaint.complaintType === 'string' &&
    complaint.complaintType.length > 0
  );
}

export function validateIssueAnalytics(data: unknown): data is IssueAnalytics {
  if (!data || typeof data !== 'object') {
    console.error('IssueAnalytics validation failed: data is not an object');
    return false;
  }
  const analytics = data as Record<string, unknown>;
  if (!Array.isArray(analytics.links) || !analytics.links.every(validateLinkPerformance)) {
    console.error('IssueAnalytics validation failed: invalid links');
    return false;
  }
  if (!Array.isArray(analytics.clickDecay) || !analytics.clickDecay.every(validateClickDecayPoint)) {
    console.error('IssueAnalytics validation failed: invalid clickDecay');
    return false;
  }
  if (!Array.isArray(analytics.geoDistribution) || !analytics.geoDistribution.every(validateGeoData)) {
    console.error('IssueAnalytics validation failed: invalid geoDistribution');
    return false;
  }
  if (!validateDeviceBreakdown(analytics.deviceBreakdown)) {
    console.error('IssueAnalytics validation failed: invalid deviceBreakdown');
    return false;
  }
  if (!validateTimingMetrics(analytics.timingMetrics)) {
    console.error('IssueAnalytics validation failed: invalid timingMetrics');
    return false;
  }
  if (!validateEngagementType(analytics.engagementType)) {
    console.error('IssueAnalytics validation failed: invalid engagementType');
    return false;
  }
  if (!validateBounceReasons(analytics.bounceReasons)) {
    console.error('IssueAnalytics validation failed: invalid bounceReasons');
    return false;
  }
  if (!Array.isArray(analytics.complaintDetails) || !analytics.complaintDetails.every(validateComplaintDetail)) {
    console.error('IssueAnalytics validation failed: invalid complaintDetails');
    return false;
  }
  return true;
}

export function validateIssueStats(data: unknown): data is IssueStats {
  if (!data || typeof data !== 'object') {
    console.error('IssueStats validation failed: data is not an object');
    return false;
  }
  const stats = data as Record<string, unknown>;
  if (!isNonNegativeNumber(stats.opens)) {
    console.error('IssueStats validation failed: invalid opens');
    return false;
  }
  if (!isNonNegativeNumber(stats.clicks)) {
    console.error('IssueStats validation failed: invalid clicks');
    return false;
  }
  if (!isNonNegativeNumber(stats.deliveries)) {
    console.error('IssueStats validation failed: invalid deliveries');
    return false;
  }
  if (!isNonNegativeNumber(stats.bounces)) {
    console.error('IssueStats validation failed: invalid bounces');
    return false;
  }
  if (!isNonNegativeNumber(stats.complaints)) {
    console.error('IssueStats validation failed: invalid complaints');
    return false;
  }
  if (!isNonNegativeNumber(stats.subscribers)) {
    console.error('IssueStats validation failed: invalid subscribers');
    return false;
  }
  if (stats.analytics !== undefined && !validateIssueAnalytics(stats.analytics)) {
    console.error('IssueStats validation failed: invalid analytics');
    return false;
  }
  return true;
}
