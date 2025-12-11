import React, { useState } from 'react';
import {
  OptimizedVariablePicker,
  OptimizedVariableAutocomplete,
  VariablePerformanceMonitor
} from '@/components/templates';
import {
  useOptimizedVariableSearch,
  useOptimizedVariableFilter,
  useMemoizedVariableDefinitions
} from '@/hooks';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { Variable, ControlFlowHelper, ComponentType } from '@/types/variable';

const PerformanceOptimizationsUsage: React.FC = () => {
  const [selectedVariable, setSelectedVariable] = useState<Variable | null>(null);
  const [selectedControlFlow, setSelectedControlFlow] = useState<ControlFlowHelper | null>(null);
  const [contextType, setContextType] = useState<ComponentType>('heading');
  const [showPicker, setShowPicker] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // Optimized hooks usage
  const {
    query,
    results,
    isSearching,
    searchStats,
    setQuery,
    clearQuery
  } = useOptimizedVariableSearch({
    contextType,
    debounceDelay: 200,
    maxResults: 20,
    enableCaching: true,
    enablePreloading: true
  });

  const {
    selectedCategory,
    variables,
    allCategories,
    filterStats,
    setSelectedCategory
  } = useOptimizedVariableFilter({
    contextType,
    enableCaching: true,
    enablePreloading: true,
    sortBy: 'priority'
  });

  const {
    definitions,
    allVariables,
    stats
  } = useMemoizedVariableDefinitions({
    includeCustomVariables: true,
    contextType,
    enableCaching: true
  });

  const handleVariableSelect = (variable: Variable) => {
    setSelectedVariable(variable);
    setShowPicker(false);
  };

  const handleControlFlowSelect = (helper: ControlFlowHelper) => {
    setSelectedControlFlow(helper);
    setShowPicker(false);
  };

  const handleVariableInsert = (variable: Variable, position: number) => {
    console.log('Variable inserted:', variable, 'at position:', position);
  };

  const handleControlFlowInsert = (helper: ControlFlowHelper, position: number) => {
    console.log('Control flow inserted:', helper, 'at position:', position);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Performance Optimizations Demo
        </h1>
        <p className="text-gray-600">
          Demonstrating optimized variable search, filtering, and caching
        </p>
      </div>

      {/* Performance Monitor */}
      <VariablePerformanceMonitor
        showDetails={true}
        refreshInterval={3000}
        className="mb-6"
      />

      {/* Context Type Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Context Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {(['heading', 'text', 'button', 'image', 'link'] as ComponentType[]).map(type => (
              <Button
                key={type}
                variant={contextType === type ? 'default' : 'outline'}
                size="sm"
                onClick={() => setContextType(type)}
              >
                {type}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Optimized Search Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Optimized Variable Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search variables..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <Button onClick={clearQuery} variant="outline">
              Clear
            </Button>
          </div>

          {/* Search Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Results</div>
              <div className="font-medium">{results.length}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Search Time</div>
              <div className="font-medium">
                {searchStats.searchTime.toFixed(1)}ms
              </div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Cache Hit</div>
              <div className="font-medium">
                {searchStats.cacheHit ? 'Yes' : 'No'}
              </div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Status</div>
              <div className="font-medium">
                {isSearching ? 'Searching...' : 'Ready'}
              </div>
            </div>
          </div>

          {/* Search Results */}
          {results.length > 0 && (
            <div className="border rounded-lg max-h-40 overflow-auto">
              {results.slice(0, 5).map(variable => (
                <div
                  key={variable.id}
                  className="p-2 border-b last:border-b-0 hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleVariableSelect(variable)}
                >
                  <div className="font-medium text-sm">{variable.name}</div>
                  <div className="text-xs text-gray-500">{variable.path}</div>
                </div>
              ))}
              {results.length > 5 && (
                <div className="p-2 text-xs text-gray-500 text-center">
                  +{results.length - 5} more results
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Optimized Filter Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Optimized Variable Filter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={!selectedCategory ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(null)}
            >
              All Categories
            </Button>
            {allCategories.map(({ category, label, count }) => (
              <Button
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category)}
              >
                {label} ({count})
              </Button>
            ))}
          </div>

          {/* Filter Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Filtered Count</div>
              <div className="font-medium">{variables.length}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Filter Time</div>
              <div className="font-medium">
                {filterStats.filterTime.toFixed(1)}ms
              </div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-gray-500">Cache Hit</div>
              <div className="font-medium">
                {filterStats.cacheHit ? 'Yes' : 'No'}
              </div>
            </div>
          </div>

          {/* Filtered Variables */}
          {variables.length > 0 && (
            <div className="border rounded-lg max-h-40 overflow-auto">
              {variables.slice(0, 5).map(variable => (
                <div
                  key={variable.id}
                  className="p-2 border-b last:border-b-0 hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleVariableSelect(variable)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-sm">{variable.name}</div>
                      <div className="text-xs text-gray-500">{variable.path}</div>
                    </div>
                    <span className="text-xs bg-gray-100 px-1 rounded">
                      {variable.type}
                    </span>
                  </div>
                </div>
              ))}
              {variables.length > 5 && (
                <div className="p-2 text-xs text-gray-500 text-center">
                  +{variables.length - 5} more variables
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Optimized Variable Picker Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Optimized Variable Picker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={() => setShowPicker(!showPicker)}>
              {showPicker ? 'Hide' : 'Show'} Variable Picker
            </Button>
            {selectedVariable && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">Selected:</span>
                <code className="bg-gray-100 px-2 py-1 rounded">
                  {selectedVariable.path}
                </code>
              </div>
            )}
          </div>

          {showPicker && (
            <div className="border rounded-lg">
              <OptimizedVariablePicker
                onVariableSelect={handleVariableSelect}
                onControlFlowSelect={handleControlFlowSelect}
                contextType={contextType}
                showSearch={true}
                showCategories={true}
                showControlFlow={true}
                maxHeight={400}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Autocomplete Demo */}
      <Card>
        <CardHeader>
          <CardTitle>Optimized Variable Autocomplete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Input
              placeholder="Type {{ to trigger autocomplete..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="font-mono"
            />
            <OptimizedVariableAutocomplete
              inputRef={{ current: document.querySelector('input[placeholder*="autocomplete"]') as HTMLInputElement }}
              onVariableInsert={handleVariableInsert}
              onControlFlowInsert={handleControlFlowInsert}
              contextType={contextType}
              maxSuggestions={8}
              debounceDelay={150}
            />
          </div>
          <div className="text-sm text-gray-500">
            Try typing patterns like: <code>{`{{newsletter`}</code>, <code>{`{{subscriber`}</code>, or <code>{`{{#if`}</code>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-blue-50 p-3 rounded">
              <div className="text-blue-600 font-medium">Total Variables</div>
              <div className="text-2xl font-bold text-blue-900">
                {stats.totalVariables}
              </div>
            </div>
            <div className="bg-green-50 p-3 rounded">
              <div className="text-green-600 font-medium">Custom Variables</div>
              <div className="text-2xl font-bold text-green-900">
                {stats.customVariables}
              </div>
            </div>
            <div className="bg-purple-50 p-3 rounded">
              <div className="text-purple-600 font-medium">Cache Hit Rate</div>
              <div className="text-2xl font-bold text-purple-900">
                {stats.cacheHitRate.toFixed(1)}%
              </div>
            </div>
            <div className="bg-orange-50 p-3 rounded">
              <div className="text-orange-600 font-medium">Last Updated</div>
              <div className="text-sm font-medium text-orange-900">
                {stats.lastUpdated.toLocaleTimeString()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PerformanceOptimizationsUsage;
