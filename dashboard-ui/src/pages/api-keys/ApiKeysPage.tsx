import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { useToast } from '@/components/ui/Toast';
import { AppHeader } from '@/components/layout/AppHeader';
import { apiKeyService } from '@/services/apiKeyService';
import {
  ApiKeyList,
  CreateApiKeyModal,
  ApiKeyCreatedModal,
  DeleteConfirmModal
} from './components';
import type { ApiKey } from '@/types';
import { PlusIcon, KeyIcon } from '@heroicons/react/24/outline';

export const ApiKeysPage: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<Omit<ApiKey, 'keyValue'>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<ApiKey | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<{ key: Omit<ApiKey, 'keyValue'>; isRevoke: boolean } | null>(null);
  const { addToast } = useToast();

  const loadApiKeys = useCallback(async () => {
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
  }, [addToast]);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

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
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center min-h-96">
            <Loading />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-2">
            <KeyIcon className="h-8 w-8 text-primary-600" />
            <h1 className="text-3xl font-bold text-foreground">API Keys</h1>
          </div>
          <p className="text-muted-foreground">
            Manage your API keys for accessing the newsletter service programmatically
          </p>
        </div>

        <div className="space-y-6">
          {/* Create API Key Button */}
          <div className="flex justify-end">
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center"
            >
              <PlusIcon className="w-4 h-4 mr-2" />
              Create API Key
            </Button>
          </div>

          {/* API Keys List */}
          {apiKeys.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
                  <KeyIcon className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">No API keys yet</h3>
                <p className="text-muted-foreground mb-6">
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
        </div>

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
      </main>
    </div>
  );
};
