import React, { useState, useEffect } from 'react';
import { DocumentTextIcon, PlusIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { TemplateList } from '@/components/templates/TemplateList';
import { TemplatePreview } from '@/components/templates/TemplatePreview';
import { TemplateHelpContent, TemplateQuickTips } from '@/components/templates/TemplateHelpContent';
import { useNavigate } from 'react-router-dom';
import { templateService } from '@/services/templateService';
import type { Template, Snippet } from '@/types/template';

type ViewMode = 'list' | 'create' | 'edit' | 'preview' | 'create-snippet' | 'edit-snippet';

export const TemplatesPage: React.FC = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFirstTime, setIsFirstTime] = useState(false);

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const response = await templateService.getTemplates();
        const templateList = response.data?.templates || [];
        setTemplates(templateList);
        setIsFirstTime(templateList.length === 0);
      } catch (error) {
        console.error('Failed to load templates:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
  }, []);

  const handleCreateTemplate = () => {
    navigate('/templates/new');
  };

  const handleEditTemplate = (template: Template) => {
    navigate(`/templates/${template.id}`);
  };

  const handlePreviewTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setViewMode('preview');
  };

  const handleCancel = () => {
    setViewMode('list');
    setSelectedTemplate(null);
  };

  const handleImportExport = () => {
    // TODO: Implement import/export functionality
    console.log('Import/Export clicked');
  };

  const renderContent = () => {
    switch (viewMode) {
      case 'preview':
        return (
          <div className="space-y-6">
            {/* Preview Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Preview Template</h1>
                <p className="text-gray-600">{selectedTemplate?.name}</p>
              </div>
              <div className="flex items-center space-x-3">
                <Button
                  variant="outline"
                  onClick={() => handleEditTemplate(selectedTemplate!)}
                >
                  Edit Template
                </Button>
                <Button variant="outline" onClick={handleCancel}>
                  Back to Templates
                </Button>
              </div>
            </div>

            {/* Preview Component */}
            <TemplatePreview template={selectedTemplate!} />
          </div>
        );

      default:
        return (
          <TemplateList
            onEditTemplate={handleEditTemplate}
            onPreviewTemplate={handlePreviewTemplate}
          />
        );
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header - only show on list view */}
        {viewMode === 'list' && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <DocumentTextIcon className="h-8 w-8 text-blue-600" />
                <h1 className="text-3xl font-bold text-gray-900">Templates</h1>
              </div>
              <div className="flex items-center space-x-3">
                <TemplateQuickTips.PreviewButton>
                  <Button variant="outline" onClick={handleImportExport} className="flex items-center">
                    <ArrowUpTrayIcon className="w-4 h-4 mr-2" />
                    Import/Export
                  </Button>
                </TemplateQuickTips.PreviewButton>
                <TemplateQuickTips.SaveButton>
                  <Button onClick={handleCreateTemplate} className="flex items-center">
                    <PlusIcon className="w-4 h-4 mr-2" />
                    Create Template
                  </Button>
                </TemplateQuickTips.SaveButton>
              </div>
            </div>
            <p className="text-gray-600">
              Manage your newsletter templates and create engaging content for your subscribers.
            </p>
          </div>
        )}

        {/* Help Content */}
        {viewMode === 'list' && !loading && (
          <div className="mb-6">
            <TemplateHelpContent
              context="list"
              hasTemplates={templates.length > 0}
              isFirstTime={isFirstTime}
            />
          </div>
        )}

        {viewMode === 'preview' && (
          <div className="mb-6">
            <TemplateHelpContent context="preview" />
          </div>
        )}

        {/* Dynamic Content */}
        {renderContent()}
      </div>
    </div>
  );
};
