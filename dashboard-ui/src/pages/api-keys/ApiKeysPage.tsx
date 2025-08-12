import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { useToast } from '@/components/ui/Toast';
import { apiKeyService } from '@/services/apiKeyService';
import {
  ApiKeyList,
  CreateApiKeyModal,
  ApiKeyCreatedModal,
  DeleteConfirmModal
} from './components';
import type { ApiKey } from '@/types';
import { PlusIcon } from '@heroicons/react/24/outline';

export const ApiKeysPage: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<Omit<ApiKey, 'keyValue'>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<ApiKey | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<{ key: Omit<ApiKey, 'keyValue'>; isRevoke: boolean } | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    try {
      setIsLoading(true);
      const response = await apiKeyService.listApiKeys();

      if (response.success && response.data) {
        setApiKeys(response.data.apiKeys);
      } else {
        addToast({ title: 'Failed to load API keys', type: 'error' });
      }
    } catch (error) {
      console.error('Error loading API keys:', error);
      addToast({ title: 'Failed to load API keys', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateApiKey = async (data: { name: string; description?: string; expiresAt?: string }) => {
    try {
      const response = await apiKeyService.createApiKey(data);

      if (response.success && response.data) {
        // Create a full ApiKey object from the response
        const createdKey: ApiKey = {
          keyId: response.data.id,
          keyValue: response.data.value,
          name: data.name,
          description: data.description,
          createdAt: new Date().toISOString(),
          lastUsed: undefined,
          usageCount: 0,
          expiresAt: data.expiresAt,
          status: 'active',
        };

        setCreatedApiKey(createdKey);
        setIsCreateModalOpen(false);
        await loadApiKeys(); // Refresh the list
        addToast({ title: 'API key created successfully', type: 'success' });
      } else {
        addToast({ title: response.error || 'Failed to create API key', type: 'error' });
      }
    } catch (error) {
      console.error('Error creating API key:', error);
      addToast({ title: 'Failed to create API key', type: 'error' });
    }
  };

  const handleDeleteApiKey = async (keyId: string, isRevoke: boolean) => {
    try {
      const response = isRevoke
        ? await apiKeyService.revokeApiKey(keyId)
        : await apiKeyService.deleteApiKey(keyId);

      if (response.success) {
        await loadApiKeys(); // Refresh the list
        addToast({
          title: isRevoke ? 'API key revoked successfully' : 'API key deleted successfully',
          type: 'success'
        });
      } else {
        addToast({ title: response.error || `Failed to ${isRevoke ? 'revoke' : 'delete'} API key`, type: 'error' });
      }
    } catch (error) {
      console.error(`Error ${isRevoke ? 'revoking' : 'deleting'} API key:`, error);
      addToast({ title: `Failed to ${isRevoke ? 'revoke' : 'delete'} API key`, type: 'error' });
    } finally {
      setKeyToDelete(null);
    }
  };

  const handleRevokeRequest = (apiKey: Omit<ApiKey, 'keyValue'>) => {
    setKeyToDelete({ key: apiKey, isRevoke: true });
  };

  const handleDeleteRequest = (apiKey: Omit<ApiKey, 'keyValue'>) => {
    setKeyToDelete({ key: apiKey, isRevoke: false });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-96">
          <Loading />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">API Keys</h1>
            <p className="text-gray-600 mt-1 text-sm sm:text-base">
              Manage your API keys for accessing the newsletter service programmatically
            </p>
          </div>
          <Button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center justify-center w-full sm:w-auto"
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            Create API Key
          </Button>
        </div>

        {/* API Keys List */}
        {apiKeys.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <PlusIcon className="w-6 h-6 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No API keys yet</h3>
              <p className="text-gray-500 mb-6">
                Create your first API key to start integrating with the newsletter service
              </p>
              <Button onClick={() => setIsCreateModalOpen(true)}>
                Create API Key
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Your API Keys</CardTitle>
              <CardDescription>
                {apiKeys.length} API key{apiKeys.length !== 1 ? 's' : ''} configured
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApiKeyList
                apiKeys={apiKeys}
                onRevoke={handleRevokeRequest}
                onDelete={handleDeleteRequest}
              />
            </CardContent>
          </Card>
        )}

        {/* Modals */}
        <CreateApiKeyModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={handleCreateApiKey}
        />

        {createdApiKey && (
          <ApiKeyCreatedModal
            isOpen={!!createdApiKey}
            onClose={() => setCreatedApiKey(null)}
            apiKey={createdApiKey}
          />
        )}

        {keyToDelete && (
          <DeleteConfirmModal
            isOpen={!!keyToDelete}
            onClose={() => setKeyToDelete(null)}
            onConfirm={() => handleDeleteApiKey(keyToDelete.key.keyId, keyToDelete.isRevoke)}
            apiKey={keyToDelete.key}
            isRevoke={keyToDelete.isRevoke}
          />
        )}
      </div>
    </Layout>
  );
};
