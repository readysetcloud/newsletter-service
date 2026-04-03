export interface PricingMetrics {
  subscriberCount: number;
  avgOpenRate: number;
  avgClickRate: number;
  avgBounceRate: number;
  avgComplaintRate: number;
  subscriberGrowthRate: number;
  publishedIssueCount: number;
}

export interface Multiplier {
  raw: number;
  clamped: number;
  smoothed: number;
}

export interface PricingRecord {
  recommendedPrice: number;
  baselinePrice: number;
  multiplier: Multiplier;
  llmConfidence?: 'low' | 'medium' | 'high' | null;
  confidenceOverride?: boolean;
  confidence: 'low' | 'medium' | 'high';
  justification: string;
  metrics: PricingMetrics;
  calculatedAt: string;
  metricsAsOf: string;
  weekWindow: string;
  pricingModelVersion?: string;
  isFallback: boolean;
  smoothingApplied: boolean;
  questionnaireVersion?: string;
  questionnaireResponses?: Record<string, unknown>;
}

export interface PricingData {
  current: PricingRecord | null;
  hasPricing: boolean;
  firstCalculationPending: boolean;
}

export interface PricingHistoryData {
  history: PricingRecord[];
  count: number;
}

export interface JobStatus {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  result?: PricingRecord;
  error?: string;
}

export interface QuestionnaireQuestion {
  id: string;
  category: string;
  text: string;
  type: 'text' | 'single-select' | 'multi-select';
  options?: string[];
}

export interface Questionnaire {
  version: string;
  questions: QuestionnaireQuestion[];
  existingResponses?: Record<string, unknown>;
}

export interface QuestionnaireResponse {
  questionId: string;
  answer: unknown;
}
