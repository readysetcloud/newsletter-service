import type { HealthStatus, HealthLabel } from '../components/analytics/HealthStatusLabel';
import type { IssueMetrics } from '../types/issues';

export interface HealthThresholds {
  good: number;
  warning: number;
}

export interface HealthStatusResult {
  status: HealthStatus;
  label: HealthLabel;
}

export function calculatePercentageDifference(current: number, comparison: number): number {
  if (comparison === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - comparison) / comparison) * 100;
}

export function calculateHealthStatus(
  current: number,
  average: number,
  thresholds: HealthThresholds
): HealthStatusResult {
  const tolerance = 0.5;
  const difference = current - average;
  const percentDiff = Math.abs(calculatePercentageDifference(current, average));

  if (Math.abs(difference) <= tolerance) {
    return { status: 'healthy', label: 'Stable' };
  }

  if (difference > 0) {
    return { status: 'healthy', label: 'Improving' };
  }

  if (percentDiff >= thresholds.warning) {
    return { status: 'critical', label: 'Declining' };
  }

  if (percentDiff >= thresholds.good) {
    return { status: 'warning', label: 'Declining' };
  }

  return { status: 'healthy', label: 'Declining' };
}

export function calculateCompositeScore(metrics: IssueMetrics): number {
  const openRateWeight = 0.4;
  const clickRateWeight = 0.4;
  const bounceRateWeight = 0.2;

  const normalizedOpenRate = metrics.openRate / 100;
  const normalizedClickRate = metrics.clickRate / 100;
  const normalizedBounceRate = Math.max(0, 1 - (metrics.bounceRate / 100));

  const score = (
    normalizedOpenRate * openRateWeight +
    normalizedClickRate * clickRateWeight +
    normalizedBounceRate * bounceRateWeight
  ) * 100;

  return Math.round(score * 100) / 100;
}

export function calculateComplaintRate(complaints: number, deliveries: number): number {
  if (deliveries === 0) return 0;
  return (complaints / deliveries) * 100;
}

export function isHighComplaintRate(complaintRate: number, threshold: number = 0.1): boolean {
  return complaintRate > threshold;
}
