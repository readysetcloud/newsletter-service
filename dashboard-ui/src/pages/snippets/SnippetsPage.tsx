import React, { useState, useEffect } from 'react';
import { CodeBracketIcon, PlusIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { SnippetList } from '@/components/templates/SnippetList';
import { SnippetBuilder } from '@/components/templates/SnippetBuilder';
import { SnippetPreview } from '@/components/templates/SnippetPreview';
import { SnippetHelpContent, SnippetQuickTips } from '@/components/templates/SnippetHelpContent';
import { templateService } from '@/services/templateService';
import type { Snippet } from '@/types/template';

type ViewMode = 'list' | 'create' | 'edit' | 'preview';

export const SnippetsPage: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedSnippet, setSelectedSnippet] = useState<Snippet | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFirstTime, setIsFirstTime] = useState(false);

  useEffect(() => {
    const loadSnippets = async () => {
      try {
        const response = await templateService.getSnippets();
        const snippetList = response.data?.snippets || [];
        setSnippets(snippetList);
        setIsFirstTime(snippetList.length === 0);
      } catch (error) {
        console.error('Failed to load snippets:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSnippets();
  }, []);

  const handleCreateSnippet = () => {
    setSelectedSnippet(null);
    setViewMode('create');
  };

  const handleEditSnippet = (snippet: Snippet) => {
    setSelectedSnippet(snippet);
    setViewMode('edit');
  };

  const handlePreviewSnippet = (snippet: Snippet) => {
    setSelectedSnippet(snippet);
    setViewMode('preview');
  };

  const handleSaveSnippet = (snippet: Snippet) => {
    // Refresh the list and return to list view
    setViewMode('list');
    setSelectedSnippet(null);
  };

  const handleCancel = () => {
    setViewMode('list');
    setSelectedSnippet(null);
  };

  const handleImportExport = () => {
    // TODO: Implement import/export functionality for snippets
    console.log('Snippet Import/Export clicked');
  };

  const renderContent = () => {
    switch (viewMode) {
      case 'create':
        return (
          <SnippetBuilder
            onSave={handleSaveSnippet}
            onCancel={handleCancel}
            className="max-w-7xl mx-auto"
          />
        );

      case 'edit':
        return (
          <SnippetBuilder
            snippet={selectedSnippet!}
            onSave={handleSaveSnippet}
            onCancel={handleCancel}
            className="max-w-7xl mx-auto"
          />
        );

      case 'preview':
        return (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Preview Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Preview Snippet</h1>
                <p className="text-gray-600">{selectedSnippet?.name}</p>
              </div>
              <div className="flex items-center space-x-3">
                <Button
                  variant="outline"
                  onClick={() => handleEditSnippet(selectedSnippet!)}
                >
                  Edit Snippet
                </Button>
                <Button variant="outline" onClick={handleCancel}>
                  Back to Snippets
                </Button>
              </div>
            </div>

            {/* Preview Component */}
            <SnippetPreview snippet={selectedSnippet!} />
          </div>
        );

      default:
        return (
          <div className="max-w-7xl mx-auto">
            <SnippetList
              onCreateSnippet={handleCreateSnippet}
              onEditSnippet={handleEditSnippet}
              onPreviewSnippet={handlePreviewSnippet}
            />
          </div>
        );
    }
  };

  return (
    <div className="p-6">
      {/* Header - only show on list view */}
      {viewMode === 'list' && (
        <div className="max-w-7xl mx-auto mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <CodeBracketIcon className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">Snippets</h1>
            </div>
            <div className="flex items-center space-x-3">
              <SnippetQuickTips.PreviewButton>
                <Button variant="outline" onClick={handleImportExport} className="flex items-center">
                  <ArrowUpTrayIcon className="w-4 h-4 mr-2" />
                  Import/Export
                </Button>
              </SnippetQuickTips.PreviewButton>
              <SnippetQuickTips.SaveButton>
                <Button onClick={handleCreateSnippet} className="flex items-center">
                  <PlusIcon className="w-4 h-4 mr-2" />
                  Create Snippet
                </Button>
              </SnippetQuickTips.SaveButton>
            </div>
          </div>
          <p className="text-gray-600">
            Create and manage reusable template components with configurable parameters.
          </p>
        </div>
      )}

      {/* Help Content */}
      {viewMode === 'list' && !loading && (
        <div className="max-w-7xl mx-auto mb-6">
          <SnippetHelpContent
            context="list"
            hasSnippets={snippets.length > 0}
            isFirstTime={isFirstTime}
          />
        </div>
      )}

      {(viewMode === 'create' || viewMode === 'edit') && (
        <div className="max-w-7xl mx-auto mb-6">
          <SnippetHelpContent
            context="builder"
            isFirstTime={viewMode === 'create' && isFirstTime}
          />
        </div>
      )}

      {viewMode === 'preview' && (
        <div className="max-w-7xl mx-auto mb-6">
          <SnippetHelpContent context="preview" />
        </div>
      )}

      {/* Dynamic Content */}
      {renderContent()}
    </div>
  );
};
