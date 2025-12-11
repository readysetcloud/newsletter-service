import React from 'react';
import {
  DocumentTextIcon,
  PaintBrushIcon,
  CodeBracketIcon,
  EyeIcon,
  SparklesIcon,
  CursorArrowRaysIcon,
  SwatchIcon
} from '@heroicons/react/24/outline';
import { HelpText, QuickTip } from '@/components/ui/HelpText';

interface TemplateHelpContentProps {
  context: 'list' | 'builder' | 'visual' | 'code' | 'preview';
  hasTemplates?: boolean;
  isFirstTime?: boolean;
}

export const TemplateHelpContent: React.FC<TemplateHelpContentProps> = ({
  context,
  hasTemplates = false,
  isFirstTime = false
}) => {
  switch (context) {
    case 'list':
      if (!hasTemplates) {
        return (
          <HelpText
            id="templates-getting-started"
            title="Welcome to Templates! 🎨"
            variant="magic"
            content={
              <div className="space-y-3">
                <p>
                  Templates are the foundation of your newsletters. They define the structure,
                  styling, and layout that will be used when sending emails to your subscribers.
                </p>
                <div className="bg-white/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center space-x-2 text-sm">
                    <DocumentTextIcon className="h-4 w-4 text-blue-600" />
                    <span><strong>Visual Builder:</strong> Drag and drop components</span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <CodeBracketIcon className="h-4 w-4 text-green-600" />
                    <span><strong>Code Editor:</strong> Write Handlebars templates</span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <SparklesIcon className="h-4 w-4 text-purple-600" />
                    <span><strong>Snippets:</strong> Reusable components</span>
                  </div>
                </div>
                <p className="text-sm">
                  <strong>Ready to start?</strong> Click "Create Template" to build your first newsletter template!
                </p>
              </div>
            }
          />
        );
      }

      return (
        <HelpText
          id="templates-list-tips"
          title="Template Management Tips 💡"
          variant="tip"
          content={
            <div className="space-y-2">
              <p>Here are some tips to get the most out of your templates:</p>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Use descriptive names to easily identify templates</li>
                <li>• Create a base template and duplicate it for variations</li>
                <li>• Test templates with sample data before sending</li>
                <li>• Use snippets for content you reuse across templates</li>
              </ul>
            </div>
          }
        />
      );

    case 'builder':
      return (
        <>
          <HelpText
            id="template-builder-welcome"
            title="Template Builder Guide 🛠️"
            variant="info"
            content={
              <div className="space-y-3">
                <p>
                  You're now in the template builder! Here you can create beautiful,
                  responsive email templates using our visual editor or code directly.
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-white/50 rounded p-2">
                    <div className="flex items-center space-x-2 mb-1">
                      <PaintBrushIcon className="h-4 w-4 text-blue-600" />
                      <strong>Visual Mode</strong>
                    </div>
                    <p className="text-xs">Drag components, customize properties</p>
                  </div>
                  <div className="bg-white/50 rounded p-2">
                    <div className="flex items-center space-x-2 mb-1">
                      <CodeBracketIcon className="h-4 w-4 text-green-600" />
                      <strong>Code Mode</strong>
                    </div>
                    <p className="text-xs">Write Handlebars templates directly</p>
                  </div>
                </div>
                <p className="text-sm">
                  <strong>Pro tip:</strong> Switch between modes anytime to see how your visual
                  changes translate to code!
                </p>
              </div>
            }
          />

          {isFirstTime && (
            <HelpText
              id="template-builder-first-steps"
              title="Your First Template 🚀"
              variant="success"
              delay={2000}
              content={
                <div className="space-y-2">
                  <p>Let's create your first template together:</p>
                  <ol className="text-sm space-y-1 ml-4">
                    <li>1. Add a heading component for your newsletter title</li>
                    <li>2. Add text components for your content</li>
                    <li>3. Use the preview tab to see how it looks</li>
                    <li>4. Save when you're happy with the result</li>
                  </ol>
                </div>
              }
            />
          )}
        </>
      );

    case 'visual':
      return (
        <HelpText
          id="visual-builder-tips"
          title="Visual Builder Tips ✨"
          variant="magic"
          content={
            <div className="space-y-2">
              <p>Make the most of the visual builder:</p>
              <div className="grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-start space-x-2">
                  <CursorArrowRaysIcon className="h-4 w-4 text-purple-600 mt-0.5" />
                  <span>Drag components from the palette to add them</span>
                </div>
                <div className="flex items-start space-x-2">
                  <SwatchIcon className="h-4 w-4 text-blue-600 mt-0.5" />
                  <span>Click any component to customize its properties</span>
                </div>
                <div className="flex items-start space-x-2">
                  <EyeIcon className="h-4 w-4 text-green-600 mt-0.5" />
                  <span>Use preview mode to test with real data</span>
                </div>
              </div>
            </div>
          }
        />
      );

    case 'code':
      return (
        <HelpText
          id="code-editor-help"
          title="Handlebars Template Guide 📝"
          variant="info"
          content={
            <div className="space-y-3">
              <p>Writing templates with Handlebars:</p>
              <div className="bg-gray-900 text-gray-100 rounded p-3 text-sm font-mono">
                <div className="text-green-400">{'{{newsletter.title}}'}</div>
                <div className="text-blue-400">{'{{#each articles}}'}</div>
                <div className="ml-4">{'{{this.title}}'}</div>
                <div className="text-blue-400">{'{{/each}}'}</div>
              </div>
              <div className="text-sm space-y-1">
                <p><strong>Variables:</strong> {'{{variable.name}}'}</p>
                <p><strong>Loops:</strong> {'{{#each items}}...{{/each}}'}</p>
                <p><strong>Conditions:</strong> {'{{#if condition}}...{{/if}}'}</p>
                <p><strong>Snippets:</strong> {'{{> snippetName param="value"}}'}</p>
              </div>
            </div>
          }
        />
      );

    case 'preview':
      return (
        <HelpText
          id="template-preview-help"
          title="Template Preview 👀"
          variant="success"
          content={
            <div className="space-y-2">
              <p>This is how your template will look to subscribers!</p>
              <div className="text-sm space-y-1">
                <p>• Test with different data to ensure it works correctly</p>
                <p>• Check how it looks on mobile and desktop</p>
                <p>• Verify all links and images load properly</p>
                <p>• Make sure the content flows well</p>
              </div>
            </div>
          }
        />
      );

    default:
      return null;
  }
};

export const TemplateQuickTips = {
  SaveButton: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Save your template to use it in newsletters" variant="success">
      {children}
    </QuickTip>
  ),

  PreviewButton: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Preview how your template will look to subscribers" variant="info">
      {children}
    </QuickTip>
  ),

  CodeToggle: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Switch between visual and code editing modes" variant="tip">
      {children}
    </QuickTip>
  ),

  ComponentPalette: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Drag components from here to build your template" variant="magic">
      {children}
    </QuickTip>
  ),

  VariableButton: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Insert dynamic variables like subscriber name or newsletter title" variant="info">
      {children}
    </QuickTip>
  )
};
