import React, { useState, useEffect } from 'react';
import { ExclamationTriangleIcon, CheckCircleIcon, ArrowUpIcon } from '@heroicons/react/24/outline';
import { templateService } from '../../services/templateService';

interface QuotaInfo {
  current: number;
  limit: number;
  remaining: number;
  percentage: number;
  canCreate: boolean;
}

interface QuotaStatus {
  tier: string;
  templates: QuotaInfo;
  snippets: QuotaInfo;
  overall: {
    withinLimits: boolean;
    nearLimit: boolean;
  };
  upgrades: {
    currentTier: string;
    hasUpgradeOptions: boolean;
    suggestions: Array<{
      reason: string;
      suggestedTier: string;
      benefit: string;
    }>;
  };
}

interface QuotaStatusProps {
  onUpgradeClick?: () => void;
}

export const QuotaStatus: React.FC<QuotaStatusProps> = ({ onUpgradeClick }) => {
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuotaStatus();
  }, []);

  const fetchQuotaStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      // This would be implemented in the template service
      const response = await fetch('/api/templates/quota', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch quota status');
      }

      const data = await response.json();
      setQuotaStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quota status');
    } finally {
      setLoading(false);
    }
  };

  const getTierDisplayName = (tier: string) => {
    switch (tier) {
      case 'free-tier':
        return 'Free';
      case 'creator-tier':
        return 'Creator';
      case 'pro-tier':
        return 'Pro';
      default:
        return tier;
    }
  };

  const getProgressBarColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStatusIcon = (info: QuotaInfo) => {
    if (info.percentage >= 90) {
      return <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />;
    }
    return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-red-600">
          <ExclamationTriangleIcon className="w-5 h-5 inline mr-2" />
          {error}
        </div>
      </div>
    );
  }

  if (!quotaStatus) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">
          Usage Limits - {getTierDisplayName(quotaStatus.tier)} Plan
        </h3>
        {quotaStatus.upgrades.hasUpgradeOptions && (
          <button
            onClick={onUpgradeClick}
            className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <ArrowUpIcon className="w-4 h-4 mr-1" />
            Upgrade
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Templates Quota */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              {getStatusIcon(quotaStatus.templates)}
              <span className="ml-2 text-sm font-medium text-gray-700">Templates</span>
            </div>
            <span className="text-sm text-gray-500">
              {quotaStatus.templates.current} / {quotaStatus.templates.limit}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${getProgressBarColor(quotaStatus.templates.percentage)}`}
              style={{ width: `${Math.min(quotaStatus.templates.percentage, 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{quotaStatus.templates.remaining} remaining</span>
            <span>{quotaStatus.templates.percentage}% used</span>
          </div>
        </div>

        {/* Snippets Quota */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              {getStatusIcon(quotaStatus.snippets)}
              <span className="ml-2 text-sm font-medium text-gray-700">Snippets</span>
            </div>
            <span className="text-sm text-gray-500">
              {quotaStatus.snippets.current} / {quotaStatus.snippets.limit}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${getProgressBarColor(quotaStatus.snippets.percentage)}`}
              style={{ width: `${Math.min(quotaStatus.snippets.percentage, 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{quotaStatus.snippets.remaining} remaining</span>
            <span>{quotaStatus.snippets.percentage}% used</span>
          </div>
        </div>
      </div>

      {/* Upgrade Suggestions */}
      {quotaStatus.upgrades.hasUpgradeOptions && (
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="text-sm font-medium text-blue-900 mb-2">Upgrade Recommended</h4>
          {quotaStatus.upgrades.suggestions.map((suggestion, index) => (
            <div key={index} className="text-sm text-blue-800">
              <p className="mb-1">
                Upgrade to <span className="font-medium">{getTierDisplayName(suggestion.suggestedTier)}</span> to:
              </p>
              <p className="text-blue-700">{suggestion.benefit}</p>
            </div>
          ))}
          {onUpgradeClick && (
            <button
              onClick={onUpgradeClick}
              className="mt-3 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Upgrade Now
            </button>
          )}
        </div>
      )}

      {/* Warning Messages */}
      {quotaStatus.overall.nearLimit && (
        <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
          <div className="flex">
            <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400" />
            <div className="ml-3">
              <p className="text-sm text-yellow-800">
                You're approaching your usage limits. Consider upgrading to avoid interruptions.
              </p>
            </div>
          </div>
        </div>
      )}

      {!quotaStatus.overall.withinLimits && (
        <div className="mt-4 p-3 bg-red-50 rounded-lg">
          <div className="flex">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
            <div className="ml-3">
              <p className="text-sm text-red-800">
                You have exceeded your usage limits. Please upgrade your plan or delete some items.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
