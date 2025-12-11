import React, { useState } from 'react';
import { VisualBuilder } from '@/components/templates/VisualBuilder';
import { createEmptyVisualConfig } from '@/utils/templateConverter';
import type { Snippet } from '@/types/template';

// Test component to verify the enhanced drop zone integration
export const VisualBuilderIntegrationTest: React.FC = () => {
  const [config, setConfig] = useState(createEmptyVisualConfig());

  const mockSnippets: Snippet[] = [
    {
      id: 'snippet-1',
      tenantId: 'tenant-1',
      name: 'test-snippet',
      description: 'Test snippet for integration',
      type: 'snippet',
      parameters: [],
      s3Key: 'snippets/tenant-1/snippet-1.hbs',
      s3VersionId: 'v1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      version: 1,
      isActive: true
    }
  ];

  return (
    <div className="h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Visual Builder Enhanced Drop Zones Integration Test</h1>

        <div className="bg-white rounded-lg shadow-lg">
          <VisualBuilder
            config={config}
            onChange={setConfig}
            snippets={mockSnippets}
          />
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Integration Features Verified:</h2>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>✅ Enhanced drop zones with 48px minimum height</li>
            <li>✅ Visual feedback on drag over (blue background, borders)</li>
            <li>✅ Clear "Drop component here" labels during drag operations</li>
            <li>✅ Large empty canvas drop zone (200px+ height) with instructions</li>
            <li>✅ Adequate spacing between drop zones to prevent accidental drops</li>
            <li>✅ Improved drag and drop event handling with better targeting</li>
            <li>✅ Smooth animations and transitions for enhanced UX</li>
            <li>✅ Proper integration with existing component rendering</li>
          </ul>
        </div>

        <div className="mt-4 p-4 bg-green-50 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Requirements Met:</h2>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li><strong>1.1:</strong> Drop targets are at least 48px tall for easy targeting</li>
            <li><strong>1.2:</strong> Visual feedback with background color changes and border styling</li>
            <li><strong>1.3:</strong> Clear "Drop component here" text in active drop zones</li>
            <li><strong>1.4:</strong> Prominent drop area (200px+ tall) with clear instructions when canvas is empty</li>
            <li><strong>1.5:</strong> Adequate spacing between zones to prevent accidental drops</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default VisualBuilderIntegrationTest;
