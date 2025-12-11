import React from 'react';
import {
  CodeBracketIcon,
  PuzzlePieceIcon,
  CogIcon,
  DocumentDuplicateIcon,
  BeakerIcon,
  SparklesIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
import { HelpText, QuickTip } from '@/components/ui/HelpText';

interface SnippetHelpContentProps {
  context: 'list' | 'builder' | 'parameters' | 'preview' | 'testing';
  hasSnippets?: boolean;
  isFirstTime?: boolean;
  parameterCount?: number;
}

export const SnippetHelpContent: React.FC<SnippetHelpContentProps> = ({
  context,
  hasSnippets = false,
  isFirstTime = false,
  parameterCount = 0
}) => {
  switch (context) {
    case 'list':
      if (!hasSnippets) {
        return (
          <HelpText
            id="snippets-getting-started"
            title="Welcome to Snippets! 🧩"
            variant="magic"
            content={
              <div className="space-y-3">
                <p>
                  Snippets are reusable template components that you can use across multiple
                  newsletters. Think of them as building blocks for your content!
                </p>
                <div className="bg-white/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center space-x-2 text-sm">
                    <PuzzlePieceIcon className="h-4 w-4 text-blue-600" />
                    <span><strong>Reusable:</strong> Use in multiple templates</span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <CogIcon className="h-4 w-4 text-green-600" />
                    <span><strong>Configurable:</strong> Add parameters for flexibility</span>
</div>
                  <div className="flex items-center space-x-2 text-sm">
                    <ArrowPathIcon className="h-4 w-4 text-purple-600" />
                    <span><strong>Maintainable:</strong> Update once, changes everywhere</span>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded p-2">
                  <p className="text-sm text-amber-800">
                    <strong>Example:</strong> Create a "Product Spotlight" snippet that you can
                    reuse in different newsletters with different products!
                  </p>
                </div>
              </div>
            }
          />
        );
      }

      return (
        <HelpText
          id="snippets-list-tips"
          title="Snippet Management Tips 💡"
          variant="tip"
          content={
            <div className="space-y-2">
              <p>Get the most out of your snippets:</p>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Create snippets for content patterns you use often</li>
                <li>• Use descriptive names that explain what the snippet does</li>
                <li>• Add parameters to make snippets flexible and reusable</li>
                <li>• Test snippets with different parameter values</li>
                <li>• Keep snippets focused on a single purpose</li>
              </ul>
            </div>
          }
        />
      );

    case 'builder':
      return (
        <>
          <HelpText
            id="snippet-builder-welcome"
            title="Snippet Builder Guide 🛠️"
            variant="info"
            content={
              <div className="space-y-3">
                <p>
                  Create powerful, reusable components that can be used across all your templates!
                </p>
                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div className="bg-white/50 rounded p-2">
                    <div className="flex items-center space-x-2 mb-1">
                      <CodeBracketIcon className="h-4 w-4 text-blue-600" />
                      <strong>Content</strong>
                    </div>
                    <p className="text-xs">Write your Handlebars template code</p>
                  </div>
                  <div className="bg-white/50 rounded p-2">
                    <div className="flex items-center space-x-2 mb-1">
                      <CogIcon className="h-4 w-4 text-green-600" />
                      <strong>Parameters</strong>
                    </div>
                    <p className="text-xs">Define configurable options</p>
                  </div>
                  <div className="bg-white/50 rounded p-2">
                    <div className="flex items-center space-x-2 mb-1">
                      <BeakerIcon className="h-4 w-4 text-purple-600" />
                      <strong>Testing</strong>
                    </div>
                    <p className="text-xs">Preview with different parameter values</p>
                  </div>
                </div>
              </div>
            }
          />

          {isFirstTime && (
            <HelpText
              id="snippet-builder-first-steps"
              title="Creating Your First Snippet 🚀"
              variant="success"
              delay={2000}
              content={
                <div className="space-y-2">
                  <p>Let's build a snippet step by step:</p>
                  <ol className="text-sm space-y-1 ml-4">
                    <li>1. Give your snippet a descriptive name</li>
                    <li>2. Write the Handlebars template content</li>
                    <li>3. Add parameters to make it configurable</li>
                    <li>4. Test it with different parameter values</li>
                    <li>5. Save and use it in your templates!</li>
                  </ol>
                </div>
              }
            />
          )}
        </>
      );

    case 'parameters':
      if (parameterCount === 0) {
        return (
          <HelpText
            id="snippet-parameters-intro"
            title="Add Parameters for Flexibility 🎛️"
            variant="tip"
            content={
              <div className="space-y-3">
                <p>
                  Parameters make your snippets configurable and reusable. Without parameters,
                  your snippet will always render the same content.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <p className="text-sm text-blue-800 mb-2">
                    <strong>Example:</strong> A "Call to Action" snippet could have parameters for:
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1 ml-4">
                    <li>• <code>buttonText</code> - The text on the button</li>
                    <li>• <code>buttonUrl</code> - Where the button links to</li>
                    <li>• <code>backgroundColor</code> - Button color</li>
                  </ul>
                </div>
                <p className="text-sm">
                  Click "Add Parameter" to make your snippet more flexible!
                </p>
              </div>
            }
          />
        );
      }

      return (
        <HelpText
          id="snippet-parameters-tips"
          title="Parameter Best Practices 📋"
          variant="info"
          content={
            <div className="space-y-2">
              <p>Tips for effective parameters:</p>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Use clear, descriptive parameter names</li>
                <li>• Set sensible default values</li>
                <li>• Add descriptions to explain what each parameter does</li>
                <li>• Use appropriate types (text, number, boolean, etc.)</li>
                <li>• Mark required parameters clearly</li>
              </ul>
            </div>
          }
        />
      );

    case 'preview':
      return (
        <HelpText
          id="snippet-preview-help"
          title="Snippet Preview & Testing 🔍"
          variant="success"
          content={
            <div className="space-y-2">
              <p>Test your snippet with different parameter values:</p>
              <div className="text-sm space-y-1">
                <p>• Try different parameter combinations</p>
                <p>• Check edge cases (empty values, long text, etc.)</p>
                <p>• Verify the HTML output looks correct</p>
                <p>• Test responsive behavior if applicable</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-2 mt-2">
                <p className="text-sm text-green-800">
                  <strong>Pro tip:</strong> Save different parameter sets as presets for quick testing!
                </p>
              </div>
            </div>
          }
        />
      );

    case 'testing':
      return (
        <HelpText
          id="snippet-testing-guide"
          title="Testing Your Snippet 🧪"
          variant="magic"
          content={
            <div className="space-y-3">
              <p>Thorough testing ensures your snippet works perfectly:</p>
              <div className="space-y-2 text-sm">
                <div className="flex items-start space-x-2">
                  <BeakerIcon className="h-4 w-4 text-purple-600 mt-0.5" />
                  <span>Test with minimum required parameters</span>
                </div>
                <div className="flex items-start space-x-2">
                  <DocumentDuplicateIcon className="h-4 w-4 text-blue-600 mt-0.5" />
                  <span>Try with all parameters filled</span>
                </div>
                <div className="flex items-start space-x-2">
                  <ClipboardDocumentIcon className="h-4 w-4 text-green-600 mt-0.5" />
                  <span>Check with very long and very short values</span>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-2">
                <p className="text-sm text-amber-800">
                  Remember: A well-tested snippet saves time and prevents errors in your newsletters!
                </p>
              </div>
            </div>
          }
        />
      );

    default:
      return null;
  }
};

export const SnippetQuickTips = {
  SaveButton: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Save your snippet to use it in templates" variant="success">
      {children}
    </QuickTip>
  ),

  PreviewButton: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Preview how your snippet renders with current parameters" variant="info">
      {children}
    </QuickTip>
  ),

  AddParameter: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Add parameters to make your snippet configurable" variant="tip">
      {children}
    </QuickTip>
  ),

  ParameterType: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Choose the right type for validation and better UX" variant="info">
      {children}
    </QuickTip>
  ),

  TestParameters: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Test your snippet with different parameter values" variant="magic">
      {children}
    </QuickTip>
  ),

  SnippetSyntax: ({ children }: { children: React.ReactNode }) => (
    <QuickTip tip="Use {{> snippetName param='value'}} in templates" variant="tip">
      {children}
    </QuickTip>
  )
};
