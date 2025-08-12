import { apiClient } from './api';
import type {
  ApiResponse,
  DashboardData,
} from '@/types';

/**
 * Dashboard Service - Handles dashboard data operations
 */
export class DashboardService {
  /**
   * Get dashboard data and metrics
   */
  async getDashboardData(timeframe: string = '30d'): Promise<ApiResponse<DashboardData>> {
    return apiClient.get<DashboardData>(`/dashboard?timeframe=${timeframe}`);
  }

  /**
   * Refresh dashboard data (same as getDashboardData but with cache busting)
   */
  async refreshDashboardData(timeframe: string = '30d'): Promise<ApiResponse<DashboardData>> {
    // Add timestamp to prevent caching
    const timestamp = Date.now();
    return apiClient.get<DashboardData>(`/dashboard?timeframe=${timeframe}&_t=${timestamp}`);
  }

  /**
   * Format metrics for display
   */
  formatMetrics(data: DashboardData) {
    return {
      totalSubscribers: this.formatNumber(data.tenant.subscribers),
      recentIssues: this.formatNumber(data.tenant.totalIssues),
      openRate: this.formatPercentage(data.performanceOverview.avgOpenRate / 100),
      clickRate: this.formatPercentage(data.performanceOverview.avgClickRate / 100),
      issues: data.issues,
    };
  }

  /**
   * Format number with appropriate suffixes (K, M, etc.)
   */
  private formatNumber(num: number): string {
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
  private formatPercentage(rate: number): string {
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
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
      },
      subscriber_added: {
        label: 'New Subscriber',
        icon: '👤',
        color: 'text-green-600',
        bgColor: 'bg-green-50',
      },
      api_key_created: {
        label: 'API Key Created',
        icon: '🔑',
        color: 'text-purple-600',
        bgColor: 'bg-purple-50',
      },
      brand_updated: {
        label: 'Brand Updated',
        icon: '🏢',
        color: 'text-orange-600',
        bgColor: 'bg-orange-50',
      },
    };

    return activityTypes[type as keyof typeof activityTypes] || {
      label: 'Activity',
      icon: '📝',
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
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
      color = 'text-green-600';
    } else if (score >= 60) {
      level = 'high';
      color = 'text-blue-600';
    } else if (score >= 40) {
      level = 'medium';
      color = 'text-yellow-600';
    } else {
      level = 'low';
      color = 'text-red-600';
    }

    return { score: Math.round(score), level, color };
  }
}

// Export singleton instance
export const dashboardService = new DashboardService();
