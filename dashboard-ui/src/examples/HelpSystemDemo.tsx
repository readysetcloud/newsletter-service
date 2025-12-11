import React, { useState } from 'react';
import { HelpText, QuickTip, HelpSequence } from '@/components/ui/HelpText';
import { TemplateHelpContent, TemplateQuickTips } from '@/components/templates/TemplateHelpContent';
import { SnippetHelpContent, SnippetQuickTips } from '@/components/templates/SnippetHelpContent';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { PlusIcon, EyeIcon, CodeBracketIcon } from '@heroicons/react/24/outline';

export const HelpSystemDemo: React.FC = () => {
  const [showSequence, setShowSequence] = useState(false);
  constep, setSequenceStep] = useState(0);

  const helpSequenceSteps = [
    {
      id: 'welcome',
      title: 'Welcome to the Help System',
      content: (
        <div>
          <p>This demo shows how our contextual help system works!</p>
          <p>Help content appears automatically based on the user's context and can be dismissed.</p>
        </div>
      ),
      variant: 'magic' as const,
      trigger: () => true
    },
    {
      id: 'contextual',
      title: 'Contextual Help',
      content: (
        <div>
          <p>Different help content appears based on:</p>
          <ul className="list-disc ml-4 mt-2">
            <li>Current page (templates vs snippets)</li>
            <li>User state (first time vs experienced)</li>
            <li>Available data (empty state vs populated)</li>
          </ul>
        </div>
      ),
      variant: 'info' as const,
      trigger: () => sequenceStep >= 1
    },
    {
      id: 'interactive',
      title: 'Interactive Elements',
      content: (
        <div>
          <p>Quick tips appear on hover for buttons and interactive elements.</p>
          <p>Try hovering over the buttons below!</p>
        </div>
      ),
      variant: 'tip' as const,
      trigger: () => sequenceStep >= 2
    }
  ];

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Help System Demo</h1>
        <p className="text-gray-600">
          Demonstrating contextual help content for templates and snippets
        </p>
      </div>

      {/* Help Sequence Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Help Sequence Demo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Button
              onClick={() => {
                setShowSequence(true);
                setSequenceStep(0);
              }}
              disabled={showSequence}
            >
              Start Help Sequence
            </Button>

            {showSequence && (
              <HelpSequence
                steps={helpSequenceSteps}
                onComplete={() => {
                  setShowSequence(false);
                  setSequenceStep(0);
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Template Help Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Template Help Content Examples</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-3">Empty State (First Time User)</h3>
            <TemplateHelpContent
              context="list"
              hasTemplates={false}
              isFirstTime={true}
            />
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Visual Builder Help</h3>
            <TemplateHelpContent
              context="visual"
              isFirstTime={false}
            />
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Code Editor Help</h3>
            <TemplateHelpContent context="code" />
          </div>
        </CardContent>
      </Card>

      {/* Snippet Help Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Snippet Help Content Examples</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-3">Empty State (First Time User)</h3>
            <SnippetHelpContent
              context="list"
              hasSnippets={false}
              isFirstTime={true}
            />
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Snippet Builder Help</h3>
            <SnippetHelpContent
              context="builder"
              isFirstTime={true}
            />
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Parameters Help (No Parameters)</h3>
            <SnippetHelpContent
              context="parameters"
              parameterCount={0}
            />
          </div>
        </CardContent>
      </Card>

      {/* Quick Tips Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Tips Demo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-gray-600 mb-4">
              Hover over these buttons to see contextual quick tips:
            </p>

            <div className="flex flex-wrap gap-4">
              <TemplateQuickTips.SaveButton>
                <Button className="flex items-center">
                  <PlusIcon className="w-4 h-4 mr-2" />
                  Create Template
                </Button>
              </TemplateQuickTips.SaveButton>

              <TemplateQuickTips.PreviewButton>
                <Button variant="outline" className="flex items-center">
                  <EyeIcon className="w-4 h-4 mr-2" />
                  Preview
                </Button>
              </TemplateQuickTips.PreviewButton>

              <SnippetQuickTips.AddParameter>
                <Button variant="outline" className="flex items-center">
                  <CodeBracketIcon className="w-4 h-4 mr-2" />
                  Add Parameter
                </Button>
              </SnippetQuickTips.AddParameter>

              <QuickTip tip="This is a custom quick tip!" variant="magic">
                <Button variant="ghost">
                  Custom Tip
                </Button>
              </QuickTip>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual Help Text Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Individual Help Text Components</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <HelpText
            id="demo-info"
            title="Information Help"
            variant="info"
            content={
              <div>
                <p>This is an informational help text that provides context and guidance.</p>
                <p>It can contain multiple paragraphs and rich content.</p>
              </div>
            }
          />

          <HelpText
            id="demo-tip"
            title="Pro Tip"
            variant="tip"
            content="This is a helpful tip that can improve the user's workflow!"
          />

          <HelpText
            id="demo-success"
            title="Success Message"
            variant="success"
            content="Great job! You've successfully completed this step."
          />

          <HelpText
            id="demo-magic"
            title="Magic Feature"
            variant="magic"
            content={
              <div>
                <p>✨ This feature uses AI to automatically generate content!</p>
                <p>Just provide some basic information and we'll do the rest.</p>
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
};
