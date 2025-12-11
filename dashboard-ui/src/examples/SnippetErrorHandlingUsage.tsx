import React, { useState } from 'react';
import { SnippetErrorBoundary } from '@/components/error/SnippetErrorBoundary';
import { SnippetErrorDisplay } from '@/components/templates/SnippetErrorDisplay';
import { SnippetInsertionManager } from '@/components/templates/SnippetInsertionManager';
import { Button } from '@/components/ui/Button';
import type { Snippet } from '@/types/template';

/**
 * Example component demonstrating comprehensive error handling for snippet insertion
 */
export const SnippetErrorHandlingUsage: React.FC = () => {
  const [showErrorBoundaryDemo, setShowErrorBoundaryDemo] = useState(false);
  const [showValidationDemo, setShowValidationDemo] = useState(false);
  const [showNetworkErrorDemo, setShowNetworkErrorDemo] = useState<'online' | 'offline' | false>(false);
  const [showInsertionManagerDemo, setShowInsertionManagerDemo] = useState(false);

  // Mock snippet for demonstration
  const mockSnippet: Snippet = {
    id: 'demo-snippet',
    tenantId: 'demo-tenant',
    name: 'Demo Snippet',
    description: 'A demonstration snippet with various parameter types',
    type: 'snippet',
    parameters: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'The main title'
      },
      {
        name: 'count',
        type: 'number',
        required: false,
        defaultValue: 1,
        validation: {
          min: 1,
          max: 100
        }
      },
      {
        name: 'enabled',
        type: 'boolean',
        required: false,
        defaultValue: true
      },
      {
        name: 'category',
        type: 'select',
        required: true,
        options: ['news', 'updates', 'announcements']
      }
    ],
    s3Key: 'demo-key',
    s3VersionId: 'demo-version',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
    version: 1,
    isActive: true
  };

  const [parameters, setParameters] = useState({
    title: '',
    count: -5, // Invalid value to trigger validation error
    enabled: true,
    category: 'invalid-category' // Invalid option to trigger validation error
  });

  // Component that throws an error for error boundary demo
  const ErrorThrowingComponent = () => {
    if (showErrorBoundaryDemo) {
      throw new Error('This is a demonstration error for the error boundary');
    }
    return <div>No error occurred</div>;
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Snippet Error Handling Demo
        </h1>
        <p className="text-gray-600">
          Comprehensive error handling and validation for snippet insertion
        </p>
      </div>

      {/* Error Boundary Demo */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          1. Error Boundary Demo
        </h2>
        <p className="text-gray-600 mb-4">
          Demonstrates how the error boundary catches and handles component errors gracefully.
        </p>

        <div className="space-y-4">
          <Button
            onClick={() => setShowErrorBoundaryDemo(!showErrorBoundaryDemo)}
            variant={showErrorBoundaryDemo ? "destructive" : "primary"}
          >
            {showErrorBoundaryDemo ? 'Hide Error' : 'Trigger Error'}
          </Button>

          <SnippetErrorBoundary
            context="snippet"
            onRetry={() => setShowErrorBoundaryDemo(false)}
            onRollback={() => {
              setShowErrorBoundaryDemo(false);
              console.log('Rollback triggered');
            }}
          >
            <ErrorThrowingComponent />
          </SnippetErrorBoundary>
        </div>
      </section>

      {/* Validation Error Display Demo */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          2. Validation Error Display Demo
        </h2>
        <p className="text-gray-600 mb-4">
          Shows how validation errors and warnings are displayed with helpful suggestions.
        </p>

        <div className="space-y-4">
          <Button
            onClick={() => setShowValidationDemo(!showValidationDemo)}
            variant="primary"
          >
            {showValidationDemo ? 'Hide Validation Errors' : 'Show Validation Errors'}
          </Button>

          {showValidationDemo && (
            <SnippetErrorDisplay
              errors={[
                {
                  field: 'title',
                  message: 'Title is required',
                  code: 'REQUIRED_FIELD',
                  severity: 'error'
                },
                {
                  field: 'count',
                  message: 'Count must be at least 1',
                  code: 'MIN_VALUE',
                  severity: 'error'
                },
                {
                  field: 'category',
                  message: 'Category must be one of: news, updates, announcements',
                  code: 'INVALID_OPTION',
                  severity: 'error'
                }
              ]}
              warnings={[
                {
                  field: 'description',
                  message: 'Very long text may affect performance',
                  code: 'LONG_STRING',
                  suggestion: 'Consider shortening the text or using a textarea parameter'
                }
              ]}
              validationSummary={{
                errorCount: 3,
                warningCount: 1,
                validFieldCount: 1,
                totalFieldCount: 4
              }}
              showSummary={true}
            />
          )}
        </div>
      </section>

      {/* Network Error Demo */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          3. Network Error Handling Demo
        </h2>
        <p className="text-gray-600 mb-4">
          Demonstrates network error handling with retry functionality and offline detection.
        </p>

        <div className="space-y-4">
          <div className="flex space-x-2">
            <Button
              onClick={() => setShowNetworkErrorDemo('online')}
              variant="primary"
            >
              Show Online Error
            </Button>
            <Button
              onClick={() => setShowNetworkErrorDemo('offline')}
              variant="secondary"
            >
              Show Offline Error
            </Button>
            <Button
              onClick={() => setShowNetworkErrorDemo(false)}
              variant="outline"
            >
              Clear Errors
            </Button>
          </div>

          {showNetworkErrorDemo === 'online' && (
            <SnippetErrorDisplay
              networkError={{
                message: 'Failed to connect to the server. The request timed out.',
                isRetryable: true,
                isOffline: false,
                onRetry: () => {
                  console.log('Retrying network request...');
                  alert('Retry attempted! (This is just a demo)');
                },
                onDismiss: () => setShowNetworkErrorDemo(false)
              }}
            />
          )}

          {showNetworkErrorDemo === 'offline' && (
            <SnippetErrorDisplay
              networkError={{
                message: 'No internet connection detected. Please check your network settings.',
                isRetryable: false,
                isOffline: true,
                onDismiss: () => setShowNetworkErrorDemo(false)
              }}
            />
          )}
        </div>
      </section>

      {/* Full Insertion Manager Demo */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          4. Complete Insertion Manager Demo
        </h2>
        <p className="text-gray-600 mb-4">
          Full snippet insertion manager with integrated error handling, validation, and rollback.
        </p>

        <div className="space-y-4">
          <Button
            onClick={() => setShowInsertionManagerDemo(!showInsertionManagerDemo)}
            variant="primary"
          >
            {showInsertionManagerDemo ? 'Hide Insertion Manager' : 'Show Insertion Manager'}
          </Button>

          {showInsertionManagerDemo && (
            <div className="border border-gray-300 rounded-lg p-4">
              <SnippetInsertionManager
                snippet={mockSnippet}
                parameters={parameters}
                onParametersChange={(params) => setParameters(params as any)}
                onInsert={async (insertedText, newCursorPosition) => {
                  // Simulate insertion process
                  console.log('Inserting snippet:', { insertedText, newCursorPosition });

                  // Simulate potential failure for demo
                  if (Math.random() > 0.7) {
                    throw new Error('Simulated insertion failure for demo purposes');
                  }

                  // Simulate async operation
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  alert('Snippet inserted successfully! (This is just a demo)');
                }}
                onCancel={() => setShowInsertionManagerDemo(false)}
                editorContent="This is some sample editor content where the snippet will be inserted."
                cursorPosition={25}
                selectedText="sample"
              />
            </div>
          )}
        </div>
      </section>

      {/* Parameter Controls for Demo */}
      {showInsertionManagerDemo && (
        <section className="bg-gray-50 rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Demo Parameter Controls
          </h3>
          <p className="text-gray-600 mb-4">
            Modify these parameters to see how validation errors change in real-time.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title (Required)
              </label>
              <input
                type="text"
                value={parameters.title}
                onChange={(e) => setParameters(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter a title..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Count (1-100)
              </label>
              <input
                type="number"
                value={parameters.count}
                onChange={(e) => setParameters(prev => ({ ...prev, count: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
                max="100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category (Required)
              </label>
              <select
                value={parameters.category}
                onChange={(e) => setParameters(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a category...</option>
                <option value="news">News</option>
                <option value="updates">Updates</option>
                <option value="announcements">Announcements</option>
                <option value="invalid-category">Invalid Category (for demo)</option>
              </select>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="enabled"
                checked={parameters.enabled}
                onChange={(e) => setParameters(prev => ({ ...prev, enabled: e.target.checked }))}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="enabled" className="ml-2 block text-sm text-gray-700">
                Enabled
              </label>
            </div>
          </div>
        </section>
      )}

      {/* Feature Summary */}
      <section className="bg-blue-50 rounded-lg border border-blue-200 p-6">
        <h2 className="text-xl font-semibold text-blue-900 mb-4">
          Error Handling Features Implemented
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h3 className="font-semibold text-blue-800 mb-2">✅ Client-side Validation</h3>
            <ul className="space-y-1 text-blue-700">
              <li>• Real-time parameter validation</li>
              <li>• Type checking (string, number, boolean, select)</li>
              <li>• Required field validation</li>
              <li>• Custom validation rules</li>
              <li>• Helpful error messages and suggestions</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-blue-800 mb-2">✅ Error Boundaries</h3>
            <ul className="space-y-1 text-blue-700">
              <li>• Graceful error handling</li>
              <li>• Snippet-specific error boundaries</li>
              <li>• Retry functionality</li>
              <li>• Rollback options</li>
              <li>• Development error details</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-blue-800 mb-2">✅ Network Error Handling</h3>
            <ul className="space-y-1 text-blue-700">
              <li>• Offline detection</li>
              <li>• Automatic retry with exponential backoff</li>
              <li>• Request queuing when offline</li>
              <li>• Connection quality monitoring</li>
              <li>• User-friendly error messages</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-blue-800 mb-2">✅ Rollback Functionality</h3>
            <ul className="space-y-1 text-blue-700">
              <li>• Operation history tracking</li>
              <li>• Failed insertion rollback</li>
              <li>• Checkpoint system</li>
              <li>• Persistent history storage</li>
              <li>• Batch rollback operations</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};
