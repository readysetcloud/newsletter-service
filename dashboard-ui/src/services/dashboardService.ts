import { apiClient } from './api';
import { validateTrendsData } from '@/utils/dataValidation';
import type {
  ApiResponse,
  TrendsData,
} from '@/types';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Dashboard Service - Handles dashboard data operations
 */
export class DashboardService {
  private trendsCache: Map<number, CacheEntry<TrendsData>> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get issue performance trends
   */
  async getTrends(issueCount: number = 10): Promise<ApiResponse<TrendsData>> {
    const cachedEntry = this.trendsCache.get(issueCount);
    const now = Date.now();

    if (cachedEntry && (now - cachedEntry.timestamp) < this.CACHE_TTL) {
      return {
        success: true,
        data: cachedEntry.data,
      };
    }

    const response = await apiClient.get<TrendsData>(`/issues/trends?issueCount=${issueCount}`);

    if (response.success && response.data) {
      if (!validateTrendsData(response.data)) {
        return {
          success: false,
          error: 'Invalid trends data structure received from server',
        };
      }

      this.trendsCache.set(issueCount, {
        data: response.data,
        timestamp: now,
      });
    }

    return response;
  }

  /**
   * Invalidate trends cache
   */
  invalidateTrendsCache(): void {
    this.trendsCache.clear();
  }

  /**
   * Invalidate specific cache entry
   */
  invalidateTrendsCacheEntry(issueCount: number): void {
    this.trendsCache.delete(issueCount);
  }

  /**
   * Format number with appropriate suffixes (K, M, etc.)
   */
  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Format percentage with proper decimal places
   */
  formatPercentage(rate: number): string {
    return (rate * 100).toFixed(1) + '%';
  }

  /**
   * Get activity type display information
   */
  getActivityTypeInfo(type: string) {
    const activityTypes = {
      issue_sent: {
        label: 'Issue Sent',
        icon: '📧',
        color: 'text-primary-600',
        bgColor: 'bg-primary-50',
      },
      subscriber_added: {
        label: 'New Subscriber',
        icon: '👤',
        color: 'text-success-600',
        bgColor: 'bg-success-50',
      },
      api_key_created: {
        label: 'API Key Created',
        icon: '🔑',
        color: 'text-primary-600',
        bgColor: 'bg-primary-50',
      },
      brand_updated: {
        label: 'Brand Updated',
        icon: '🏢',
        color: 'text-warning-600',
        bgColor: 'bg-warning-50',
      },
    };

    return activityTypes[type as keyof typeof activityTypes] || {
      label: 'Activity',
      icon: '📝',
      color: 'text-muted-foreground',
      bgColor: 'bg-background',
    };
  }

  /**
   * Calculate engagement score based on open and click rates
   */
  calculateEngagementScore(openRate: number, clickRate: number): {
    score: number;
    level: 'low' | 'medium' | 'high' | 'excellent';
    color: string;
  } {
    const score = (openRate * 0.7 + clickRate * 0.3) * 100;

    let level: 'low' | 'medium' | 'high' | 'excellent';
    let color: string;

    if (score >= 80) {
      level = 'excellent';
      color = 'text-success-600';
    } else if (score >= 60) {
      level = 'high';
      color = 'text-primary-600';
    } else if (score >= 40) {
      level = 'medium';
      color = 'text-warning-600';
    } else {
      level = 'low';
      color = 'text-error-600';
    }

    return { score: Math.round(score), level, color };
  }
}

// Export singleton instance
export const dashboardService = new DashboardService();
