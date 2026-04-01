import type { TrendPoint } from '@/utils/reportFormatters';

export type { TrendPoint } from '@/utils/reportFormatters';

export interface ReportData {
  brandName: string;
  brandLogo?: string;          // base64 data URL
  industry?: string;
  website?: string;
  valueNarrative: string;
  subscriberCount: number;
  avgOpenRate: number;          // decimal, e.g. 0.483
  avgClickRate: number;         // decimal, e.g. 0.12
  subscriberGrowthRate: number; // decimal, e.g. 0.052
  impressionsEstimate: number;  // subscriberCount × avgOpenRate
  recommendedPrice: number;
  confidenceLabel: string;      // human-readable mapped string
  trendData: TrendPoint[];
  growthSummary: string;
  generatedAt: Date;
  metricsAsOf: string;          // ISO 8601
  calculatedAt: string;         // ISO 8601
}
