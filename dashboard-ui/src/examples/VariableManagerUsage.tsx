import React, { useState } from 'react';
import { VariableManager } from '@/components/templates/VariableManager';
import { CustomVariable } from '@/types/variable';

export const VariableManagerUsage: React.FC = () => {
  const [variables, setVariables] = useState<CustomVariable[]>([]);

  // Mock usage map for demonstration
  const usageMap = new Map<string, string[]>([
    ['var-1', ['template-1', 'template-2']],
    ['var-2', ['template-3']],
  ]);

  const handleVariablesChange = (newVariables: CustomVariable[]) => {
    setVariables(newVariables);
    console.log('Variables updated:', newVariables);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Variable Manager Demo
        </h1>
        <p className="text-gray-600">
          This demonstrates the custom variable management system for the visual builder.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <VariableManager
          onVariablesChange={handleVariablesChange}
          existingVariables={variables}
          usageMap={usageMap}
        />
      </div>

      {/* Debug Info */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Current Variables</h3>
        <pre className="text-sm text-gray-700 overflow-auto">
          {JSON.stringify(variables, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default VariableManagerUsage;
