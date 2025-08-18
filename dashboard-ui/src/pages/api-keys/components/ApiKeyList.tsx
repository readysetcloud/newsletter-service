import React from 'react';
import { ApiKeyCard } from './ApiKeyCard';
import type { ApiKey } from '@/types';

interface ApiKeyListProps {
  apiKeys: Omit<ApiKey, 'keyValue'>[];
  onRevoke: (apiKey: Omit<ApiKey, 'keyValue'>) => void;
  onDelete: (apiKey: Omit<ApiKey, 'keyValue'>) => void;
}

export const ApiKeyList: React.FC<ApiKeyListProps> = ({
  apiKeys,
  onRevoke,
  onDelete,
}) => {
  return (
    <div className="space-y-4">
      {apiKeys.map((apiKey) => (
        <ApiKeyCard
          key={apiKey.keyId}
          apiKey={apiKey}
          onRevoke={onRevoke}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};
