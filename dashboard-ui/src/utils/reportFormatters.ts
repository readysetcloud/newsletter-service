import type { BrandInfo } from '@/types';

export interface TrendPoint {
  date: string;
  recommendedPrice: number;
  subscriberCount: number;
}

export function formatSubscriberCount(count: number): string {
  return Math.round(count).toLocaleString('en-US');
}

export function formatPercentage(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatSignedPercentage(rate: number): string {
  const value = (rate * 100).toFixed(1);
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${value}%`;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatImpressionsEstimate(count: number): string {
  return Math.round(count).toLocaleString('en-US');
}

export function formatReportDate(isoString: string): string {
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate().toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

export function computeImpressionsEstimate(subscriberCount: number, avgOpenRate: number): number {
  return subscriberCount * avgOpenRate;
}

export function mapConfidenceLabel(confidence: 'low' | 'medium' | 'high'): string {
  const labels: Record<string, string> = {
    high: 'Based on consistent engagement and stable growth',
    medium: 'Based on moderate engagement with developing trends',
    low: 'Based on early data with limited history',
  };
  return labels[confidence];
}

export function generateGrowthSummary(trendData: TrendPoint[], weeks: number): string {
  if (trendData.length < 2) {
    return `Stable pricing over last ${weeks} weeks`;
  }

  const first = trendData[0];
  const last = trendData[trendData.length - 1];
  const change = (last.recommendedPrice - first.recommendedPrice) / first.recommendedPrice;
  const pct = Math.abs(Math.round(change * 100));

  if (change > 0.02) {
    return `+${pct}% growth over last ${weeks} weeks`;
  }
  if (change < -0.02) {
    return `-${pct}% over last ${weeks} weeks — recent decline with opportunity for recovery`;
  }
  return `Stable pricing over last ${weeks} weeks`;
}

export function generateFilename(brandName: string, date: Date): string {
  const normalized = brandName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return `${normalized}-sponsor-report-${yyyy}-${mm}-${dd}.pdf`;
}

export function generateTemplateNarrative(brandInfo: BrandInfo): string {
  const name = brandInfo.brandName?.trim() || 'Newsletter';
  const industry = brandInfo.industry?.trim();
  const description = brandInfo.brandDescription?.trim();

  let narrative = '';

  if (industry) {
    narrative = `${name} is a ${industry} newsletter.`;
  } else {
    narrative = `${name} is a newsletter.`;
  }

  if (description) {
    narrative += ` ${description}`;
  }

  return narrative.trim();
}
