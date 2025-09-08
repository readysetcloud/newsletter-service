import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Handlebars from 'handlebars';
import { Button } from '@/components/ui/Button';
import { useResponsive } from '@/hooks/useResponsive';
import { templateService } from '@/services/templateService';
import { cn } from '@/utils/cn';
import type { Template, Snippet, PreviewResponse } from '@/types/template';
import {
  EyeIcon,
  DevicePhoneMobileIcon,
  DeviceTabletIcon,
  ComputerDesktopIcon,
  PaperAirplaneIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

interface TemplatePreviewProps {
  template: Template;
  snippets?: Snippet[];
  testData?: Record<string, any>;
  onTestDataChange?: (data: Record<string, any>) => void;
  className?: string;
}

type PreviewMode = 'desktop' | 'tablet' | 'mobile';

const previewModeConfig = {
  desktop: {
    icon: ComputerDesktopIcon,
    label: 'Desktop',
    width: '100%',
    maxWidth: 'none',
  },
  tablet: {
    icon: DeviceTabletIcon,
    label: 'Tablet',
    width: '768px',
    maxWidth: '768px',
  },
  mobile: {
    icon: DevicePhoneMobileIcon,
    label: 'Mobile',
    width: '375px',
    maxWidth: '375px',
  },
};

const defaultTestData = {
  title: 'Sample Newsletter Title',
  subtitle: 'Your weekly dose of awesome content',
  date: new Date().toLocaleDateString(),
  author: 'John Doe',
  content: 'This is sample content for your newsletter template.',
  unsubscribeUrl: '#unsubscribe',
  companyName: 'Your Company',
  companyAddress: '123 Main St, City, State 12345',
};

export const TemplatePreview: React.FC<TemplatePreviewProps> = ({
  template,
  snippets = [],
  testData = defaultTestData,
  onTestDataChange,
  className,
}) => {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const { isMobile } = useResponsive();

  // Register snippet helpers with Handlebars
  const registerSnippetHelpers = useCallback(() => {
    snippets.forEach(snippet => {
      if (snippet.content) {
        try {
          const snippetTemplate = Handlebars.compile(snippet.content);
          Handlebars.registerHelper(snippet.name, function(options) {
            const context = options.hash || {};

            // Apply default values for missing parameters
            if (snippet.parameters) {
              snippet.parameters.forEach(param => {
                if (context[param.name] === undefined && param.defaultValue !== undefined) {
                  context[param.name] = param.defaultValue;
                }
              });
            }

            return new Handlebars.SafeString(snippetTemplate(context));
          });
        } catch (error) {
          console.error(`Error registering snippet helper "${snippet.name}":`, error);
        }
      }
    });
  }, [snippets]);

  // Client-side template rendering
  const renderTemplate = useCallback(async () => {
    if (!template.content) {
      setRenderError('Template content is not available');
      return;
    }

    try {
      setRenderError(null);

      // Register snippet helpers
      registerSnippetHelpers();

      // Compile and render template
      const compiledTemplate = Handlebars.compile(template.content);
      const html = compiledTemplate(testData);

      setRenderedHtml(html);
    } catch (error) {
      console.error('Template rendering error:', error);
      setRenderError(error instanceof Error ? error.message : 'Failed to render template');
    }
  }, [template.content, testData, registerSnippetHelpers]);

  // Server-side preview for test email
  const sendTestEmail = useCallback(async () => {
    if (!testEmailAddress.trim()) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setIsSendingEmail(true);
    setEmailError(null);
    setEmailSent(false);

    try {
      const response = await templateService.previewTemplate(template.id, {
        testData,
        sendTestEmail: true,
        testEmailAddress: testEmailAddress.trim(),
      });

      if (response.success) {
        setEmailSent(true);
        setTimeout(() => setEmailSent(false), 3000); // Clear success message after 3 seconds
      } else {
        setEmailError(response.message || 'Failed to send test email');
      }
    } catch (error) {
      setEmailError('Failed to send test email. Please try again.');
    } finally {
      setIsSendingEmail(false);
    }
  }, [template.id, testData, testEmailAddress]);

  // Re-render when template or test data changes
  useEffect(() => {
    renderTemplate();
  }, [renderTemplate]);

  // Memoized preview content
  const previewContent = useMemo(() => {
    if (renderError) {
      return (
        <div className="flex items-center justify-center h-full min-h-[400px] bg-red-50 border border-red-200 rounded-lg">
          <div className="text-center p-6">
            <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-red-900 mb-2">Rendering Error</h3>
            <p className="text-red-700 text-sm max-w-md">{renderError}</p>
          </div>
        </div>
      );
    }

    if (!renderedHtml) {
      return (
        <div className="flex items-center justify-center h-full min-h-[400px] bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-center p-6">
            <EyeIcon className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600">Loading preview...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <iframe
          srcDoc={renderedHtml}
          className="w-full h-full min-h-[600px]"
          title="Template Preview"
          sandbox="allow-same-origin"
          style={{
            width: previewModeConfig[previewMode].width,
            maxWidth: previewModeConfig[previewMode].maxWidth,
          }}
        />
      </div>
    );
  }, [renderedHtml, renderError, previewMode]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Preview Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
        {/* Preview Mode Toggle */}
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-slate-700">Preview Mode:</span>
          <div className="flex rounded-md border border-slate-300 bg-white">
            {(Object.entries(previewModeConfig) as [PreviewMode, typeof previewModeConfig[PreviewMode]][]).map(([mode, config]) => {
              const Icon = config.icon;
              return (
                <button
                  key={mode}
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    'flex items-center px-3 py-2 text-sm font-medium transition-colors',
                    'first:rounded-l-md last:rounded-r-md',
                    previewMode === mode
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  )}
                  title={config.label}
                >
                  <Icon className="h-4 w-4" />
                  {!isMobile && <span className="ml-2">{config.label}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Test Email Section */}
        <div className="flex items-center space-x-2">
          <input
            type="email"
            placeholder="test@example.com"
            value={testEmailAddress}
            onChange={(e) => setTestEmailAddress(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isSendingEmail}
          />
          <Button
            onClick={sendTestEmail}
            disabled={isSendingEmail || !testEmailAddress.trim()}
            isLoading={isSendingEmail}
            size="sm"
            className="whitespace-nowrap"
          >
            <PaperAirplaneIcon className="h-4 w-4 mr-2" />
            Send Test
          </Button>
        </div>
      </div>

      {/* Email Status Messages */}
      {emailSent && (
        <div className="flex items-center p-3 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircleIcon className="h-5 w-5 text-green-500 mr-2" />
          <span className="text-green-800 text-sm">Test email sent successfully!</span>
        </div>
      )}

      {emailError && (
        <div className="flex items-center p-3 bg-red-50 border border-red-200 rounded-lg">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500 mr-2" />
          <span className="text-red-800 text-sm">{emailError}</span>
        </div>
      )}

      {/* Preview Container */}
      <div className="relative">
        <div
          className={cn(
            'mx-auto transition-all duration-300 ease-in-out',
            previewMode === 'mobile' && 'max-w-[375px]',
            previewMode === 'tablet' && 'max-w-[768px]',
            previewMode === 'desktop' && 'max-w-none'
          )}
        >
          {previewContent}
        </div>

        {/* Preview Mode Indicator */}
        <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs font-medium">
          {previewModeConfig[previewMode].label}
        </div>
      </div>

      {/* Test Data Editor (Optional) */}
      {onTestDataChange && (
        <details className="bg-slate-50 border border-slate-200 rounded-lg">
          <summary className="cursor-pointer p-4 font-medium text-slate-700 hover:bg-slate-100">
            Test Data (Click to expand)
          </summary>
          <div className="p-4 border-t border-slate-200">
            <textarea
              value={JSON.stringify(testData, null, 2)}
              onChange={(e) => {
                try {
                  const newData = JSON.parse(e.target.value);
                  onTestDataChange(newData);
                } catch (error) {
                  // Invalid JSON, don't update
                }
              }}
              className="w-full h-40 p-3 border border-slate-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter test data as JSON..."
            />
            <p className="mt-2 text-xs text-slate-600">
              Edit the JSON above to change the test data used in the preview.
            </p>
          </div>
        </details>
      )}
    </div>
  );
};

export default TemplatePreview;
