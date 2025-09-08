import React, { useState } from 'react';
import { VisualBuilder } from '@/components/templates/VisualBuilder';
import { visualConfigToHandlebars, createEmptyVisualConfig } from '@/utils/templateConverter';
import type { VisualConfig } from '@/utils/templateConverter';
import type { Snippet } from '@/types/template';

// Example snippets for demonstration
const exampleSnippets: Snippet[] = [
  {
    id: 'article-card',
    tenantId: 'demo',
    name: 'article-card',
    description: 'A card component for displaying articles',
    type: 'snippet',
    parameters: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'Article title'
      },
      {
        name: 'excerpt',
        type: 'string',
        required: false,
        description: 'Article excerpt'
      },
      {
        name: 'imageUrl',
        type: 'string',
        required: false,
        description: 'Article image URL'
      }
    ],
    s3Key: 'snippets/demo/article-card.hbs',
    s3VersionId: 'v1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true
  },
  {
    id: 'newsletter-header',
    tenantId: 'demo',
    name: 'newsletter-header',
    description: 'Newsletter header with logo and title',
    type: 'snippet',
    parameters: [
      {
        name: 'logoUrl',
        type: 'string',
        required: true,
        description: 'Logo image URL'
      },
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'Newsletter title'
      },
      {
        name: 'subtitle',
        type: 'string',
        required: false,
        description: 'Newsletter subtitle'
      }
    ],
    s3Key: 'snippets/demo/newsletter-header.hbs',
    s3VersionId: 'v1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true
  }
];

export const VisualBuilderUsage: React.FC = () => {
  const [visualConfig, setVisualConfig] = useState<VisualConfig>(createEmptyVisualConfig());
  const [showHandlebars, setShowHandlebars] = useState(false);

  const handleConfigChange = (newConfig: VisualConfig) => {
    setVisualConfig(newConfig);
  };

  const generatedHandlebars = visualConfigToHandlebars(visualConfig, exampleSnippets);

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Visual Builder Demo</h1>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setShowHandlebars(!showHandlebars)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {showHandlebars ? 'Hide' : 'Show'} Generated Handlebars
            </button>
            <button
              onClick={() => setVisualConfig(createEmptyVisualConfig())}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        <div className={showHandlebars ? 'w-1/2' : 'w-full'}>
          <VisualBuilder
            config={visualConfig}
            onChange={handleConfigChange}
            snippets={exampleSnippets}
          />
        </div>

        {showHandlebars && (
          <div className="w-1/2 border-l border-slate-200 bg-slate-50">
            <div className="p-4 border-b border-slate-200 bg-white">
              <h2 className="text-lg font-semibold text-slate-900">Generated Handlebars</h2>
              <p className="text-sm text-slate-600 mt-1">
                This is the handlebars template generated from your visual configuration
              </p>
            </div>
            <div className="p-4">
              <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-auto text-sm">
                <code>{generatedHandlebars || '// No components added yet'}</code>
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="bg-slate-100 border-t border-slate-200 p-4">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <div>
            Components: {visualConfig.components.length}
          </div>
          <div>
            Generated template: {generatedHandlebars.length} characters
          </div>
        </div>
      </div>
    </div>
  );
};

export default VisualBuilderUsage;
