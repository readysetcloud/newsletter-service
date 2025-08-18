import React from 'react';
import { Button } from '@/components/ui/Button';
import { apiKeyService } from '@/services/apiKeyService';
import type { ApiKey } from '@/types';
import {
  KeyIcon,
  CalendarIcon,
  ChartBarIcon,
  TrashIcon,
  NoSymbolIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

interface ApiKeyCardProps {
  apiKey: Omit<ApiKey, 'keyValue'>;
  onRevoke: (apiKey: Omit<ApiKey, 'keyValue'>) => void;
  onDelete: (apiKey: Omit<ApiKey, 'keyValue'>) => void;
}

export const ApiKeyCard: React.FC<ApiKeyCardProps> = ({
  apiKey,
  onRevoke,
  onDelete,
}) => {
  const isExpired = apiKeyService.isApiKeyExpired(apiKey);
  const isActive = apiKeyService.isApiKeyActive(apiKey);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = () => {
    if (apiKey.status === 'revoked') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <NoSymbolIcon className="w-3 h-3 mr-1" />
          Revoked
        </span>
      );
    }

    if (isExpired) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <ClockIcon className="w-3 h-3 mr-1" />
          Expired
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <KeyIcon className="w-3 h-3 mr-1" />
        Active
      </span>
    );
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-medium text-gray-900 truncate">
              {apiKey.name}
            </h3>
            {getStatusBadge()}
          </div>

          {/* Description */}
          {apiKey.description && (
            <p className="text-sm text-gray-600 mb-3">
              {apiKey.description}
            </p>
          )}

          {/* Key Value (Hidden) */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              API Key
            </label>
            <div className="flex items-center gap-2">
              <code className="bg-gray-100 px-3 py-2 rounded text-sm font-mono text-gray-600 flex-1">
                ***hidden***
              </code>
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {/* Created Date */}
            <div className="flex items-center text-gray-600">
              <CalendarIcon className="w-4 h-4 mr-2 text-gray-400" />
              <div>
                <div className="font-medium">Created</div>
                <div>{formatDate(apiKey.createdAt)}</div>
              </div>
            </div>

            {/* Usage Stats */}
            <div className="flex items-center text-gray-600">
              <ChartBarIcon className="w-4 h-4 mr-2 text-gray-400" />
              <div>
                <div className="font-medium">Usage</div>
                <div>
                  {apiKey.usageCount} request{apiKey.usageCount !== 1 ? 's' : ''}
                  {apiKey.lastUsed && (
                    <div className="text-xs text-gray-500">
                      Last used: {formatDate(apiKey.lastUsed)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Expiration */}
            <div className="flex items-center text-gray-600">
              <ClockIcon className="w-4 h-4 mr-2 text-gray-400" />
              <div>
                <div className="font-medium">Expires</div>
                <div>
                  {apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}
                </div>
              </div>
            </div>
          </div>

          {/* Revoked Info */}
          {apiKey.status === 'revoked' && apiKey.revokedAt && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">
                This API key was revoked on {formatDate(apiKey.revokedAt)} and can no longer be used.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 ml-4">
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRevoke(apiKey)}
              className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
            >
              <NoSymbolIcon className="w-4 h-4 mr-1" />
              Revoke
            </Button>
          )}

          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete(apiKey)}
          >
            <TrashIcon className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
};
