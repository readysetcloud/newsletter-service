import { pricingService } from '@/services/pricingService';
import { profileService } from '@/services/profileService';
import {
  computeImpressionsEstimate,
  mapConfidenceLabel,
  generateGrowthSummary,
  generateFilename,
  generateTemplateNarrative,
} from '@/utils/reportFormatters';
import type { TrendPoint } from '@/utils/reportFormatters';
import type { ReportData } from '@/types/report';
import type { PricingRecord } from '@/types/pricing';
import type { BrandInfo } from '@/types/api';

/**
 * Extract trend data from pricing history, bounded to the most recent 12 records.
 */
export function extractTrendData(history: PricingRecord[]): TrendPoint[] {
  const recent = history.slice(-12);
  return recent.map((record) => ({
    date: record.calculatedAt,
    recommendedPrice: record.recommendedPrice,
    subscriberCount: record.metrics.subscriberCount,
  }));
}

class ReportService {
  /**
   * Orchestrates data assembly for the sponsor export report.
   */
  async assembleReportData(): Promise<ReportData> {
    // Fire all fetches in parallel, including the LLM narrative with a 3s timeout
    const [pricingResult, historyResult, profileResult] = await Promise.all([
      pricingService.getPricing(),
      pricingService.getPricingHistory(),
      profileService.getProfile(),
    ]);

    // Pricing is required — abort if it fails
    if (!pricingResult.success || !pricingResult.data?.current) {
      throw new Error('Unable to load pricing data for report.');
    }

    const pricing = pricingResult.data.current;
    const history = historyResult.success && historyResult.data ? historyResult.data.history : [];

    // Profile is optional — use fallback if it fails
    let brandInfo: BrandInfo;
    if (profileResult.success && profileResult.data) {
      brandInfo = profileResult.data.brand;
    } else {
      brandInfo = { brandName: 'Newsletter' };
    }

    const trendData = extractTrendData(history);
    const impressionsEstimate = computeImpressionsEstimate(
      pricing.metrics.subscriberCount,
      pricing.metrics.avgOpenRate
    );
    const confidenceLabel = mapConfidenceLabel(pricing.confidence);
    const growthSummary = generateGrowthSummary(trendData, trendData.length);

    // Attempt to fetch stored narrative, fall back to template
    let valueNarrative: string;
    try {
      const narrativeResult = await pricingService.generateNarrative();
      if (narrativeResult.success && narrativeResult.data?.narrative) {
        valueNarrative = narrativeResult.data.narrative;
      } else {
        valueNarrative = generateTemplateNarrative(brandInfo);
      }
    } catch {
      valueNarrative = generateTemplateNarrative(brandInfo);
    }

    return {
      brandName: brandInfo.brandName || 'Newsletter',
      brandLogo: brandInfo.brandLogo || undefined,
      industry: brandInfo.industry || undefined,
      website: brandInfo.website || undefined,
      valueNarrative,
      subscriberCount: pricing.metrics.subscriberCount,
      avgOpenRate: pricing.metrics.avgOpenRate,
      avgClickRate: pricing.metrics.avgClickRate,
      subscriberGrowthRate: pricing.metrics.subscriberGrowthRate,
      impressionsEstimate,
      recommendedPrice: pricing.recommendedPrice,
      confidenceLabel,
      trendData,
      growthSummary,
      generatedAt: new Date(),
      metricsAsOf: pricing.metricsAsOf,
      calculatedAt: pricing.calculatedAt,
    };
  }

  /**
   * Full report generation flow: assemble data → render PDF → trigger download.
   */
  async generateReport(): Promise<void> {
    const reportData = await this.assembleReportData();

    // pdfRenderer will be fully implemented in Task 4
    const { pdfRenderer } = await import('@/services/pdfRenderer');
    const blob = await pdfRenderer.generatePdf(reportData);

    const filename = generateFilename(reportData.brandName, reportData.generatedAt);

    // Trigger browser download
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}

// Export singleton instance
export const reportService = new ReportService();
