import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { TemplateBuilder } from '@/components/templates/TemplateBuilder';
import { useNotifications } from '@/components/ui/Notifications';
import { templateService } from '@/services/templateService';
import type { Template, Snippet } from '@/types/template';

export const TemplateBuilderPage: React.FC = () => {
  const { templateId } = useParams<{ templateId?: string }>();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();

  const [template, setTemplate] = useState<Template | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load template and snippets
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);

        // Load snippets (these would come from your API)
        const mockSnippets: Snippet[] = [
          {
            id: 'header-snippet',
            tenantId: 'demo-tenant',
            name: 'Newsletter Header',
            type: 'snippet' as const,
            content: '<h1 style="color: {{brand.primaryColor}};">{{newsletter.title}}</h1>',
            description: 'Standard newsletter header with branding',
            parameters: [],
            s3Key: 'snippets/header-snippet.hbs',
            s3VersionId: '1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
            isActive: true
          },
          {
            id: 'footer-snippet',
            tenantId: 'demo-tenant',
            name: 'Newsletter Footer',
            type: 'snippet' as const,
            content: '<p style="text-align: center; color: #666;">© {{brand.name}} | <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>',
            description: 'Standard newsletter footer with unsubscribe link',
            parameters: [],
            s3Key: 'snippets/footer-snippet.hbs',
            s3VersionId: '1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
            isActive: true
          }
        ];
        setSnippets(mockSnippets);

        // Load template if editing
        if (templateId && templateId !== 'new') {
          // This would come from your API
          const mockTemplate: Template = {
            id: templateId,
            tenantId: 'demo-tenant',
            name: 'Sample Newsletter Template',
            type: 'template' as const,
            content: '<h1>{{newsletter.title}}</h1>\n<p>{{newsletter.description}}</p>',
            visualConfig: {
              components: [
                {
                  id: 'comp1',
                  type: 'heading',
                  properties: {
                    text: '{{newsletter.title}}',
                    level: 'h1',
                    align: 'center'
                  }
                },
                {
                  id: 'comp2',
                  type: 'text',
                  properties: {
                    content: 'Welcome to {{newsletter.title}}! This is issue #{{newsletter.issue}}.',
                    align: 'left'
                  }
                }
              ]
            },
            s3Key: `templates/${templateId}.hbs`,
            s3VersionId: '1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
            isActive: true
          };
          setTemplate(mockTemplate);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load template data');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [templateId]);

  const handleSave = async (updatedTemplate: Template) => {
    try {
      // This would save to your API
      console.log('Saving template:', updatedTemplate);

      // Simulate API call with name validation
      const response = templateId === 'new'
        ? await templateService.createTemplate({
            name: updatedTemplate.name,
            description: updatedTemplate.description,
            content: updatedTemplate.content || '',
            isVisualMode: updatedTemplate.isVisualMode,
            visualConfig: updatedTemplate.visualConfig
          })
        : await templateService.updateTemplate(templateId!, {
            name: updatedTemplate.name,
            description: updatedTemplate.description,
            content: updatedTemplate.content,
            isVisualMode: updatedTemplate.isVisualMode,
            visualConfig: updatedTemplate.visualConfig
          });

      if (response.success) {
        addNotification({
          type: 'success',
          title: 'Template Saved',
          message: 'Your template has been saved successfully.'
        });

        // Navigate back to templates list
        navigate('/templates');
      } else {
        // Handle name conflicts and other errors
        if (response.error && typeof response.error === 'object' && 'code' in response.error) {
          const errorData = response.error as any;
          if (errorData.code === 'NAME_EXISTS') {
            // Show name suggestions in the builder
            // This would need to be passed back to the SimpleTemplateBuilder
            addNotification({
              type: 'error',
              title: 'Template Name Conflict',
              message: errorData.error || 'A template with this name already exists'
            });
          } else {
            addNotification({
              type: 'error',
              title: 'Validation Error',
              message: errorData.error || 'Please check your template details'
            });
          }
        } else {
          addNotification({
            type: 'error',
            title: 'Save Failed',
            message: response.error || 'Failed to save template'
          });
        }
      }
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Failed to save template'
      });
    }
  };

  const handlePreview = (template: Template) => {
    // Open preview in a new window or modal
    const previewWindow = window.open('', '_blank', 'width=800,height=600');
    if (previewWindow) {
      previewWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Template Preview</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          </style>
        </head>
        <body>
          ${template.content}
        </body>
        </html>
      `);
      previewWindow.document.close();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorDisplay
          title="Failed to Load Template"
          message={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/templates')}
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Templates
            </Button>
            <h1 className="text-xl font-semibold">
              {templateId === 'new' ? 'Create New Template' : 'Edit Template'}
            </h1>
          </div>
        </div>
      </div>

      {/* Builder */}
      <div className="flex-1">
        <TemplateBuilder
          template={template || undefined}
          onSave={handleSave}
          onPreview={handlePreview}
          autoSave={true}
          autoSaveInterval={30000}
        />
      </div>
    </div>
  );
};
