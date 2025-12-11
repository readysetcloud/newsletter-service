import React, { useState } from 'react';
import { DropZoneComponent, DropZoneIndicator, EnhancedDropZones } from '@/components/templates';

/**
 * Example usage of the Enhanced Drop Zone system
 *
 * This demonstrates the improved drop zone components with:
 * - Larger hit targets (48px minimum)
 * - Visual feedback states (hover, active, drag-over)
 * - Clear text labels and animations
 * - Accessibility support
 */
export const EnhancedDropZonesUsage: React.FC = () => {
  const [componentCount, setComponentCount] = useState(0);
  const [draggedItem, setDraggedItem] = useState<any>(null);

  const handleDrop = (e: DragEvent, index: number) => {
    console.log('Dropped at index:', index);
    setComponentCount(prev => prev + 1);
    setDraggedItem(null);
  };

  const simulateDrag = () => {
    setDraggedItem({ type: 'text', label: 'Text Block' });
    setTimeout(() => setDraggedItem(null), 3000); // Auto-clear after 3 seconds
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-4">Enhanced Drop Zones Demo</h2>
        <p className="text-gray-600 mb-6">
          This demonstrates the improved drop zone system with larger hit targets,
          better visual feedback, and enhanced accessibility.
        </p>
      </div>

      {/* Controls */}
      <div className="flex gap-4">
        <button
          onClick={simulateDrag}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Simulate Drag State
        </button>
        <button
          onClick={() => setComponentCount(0)}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        >
          Reset Components
        </button>
        <button
          onClick={() => setComponentCount(prev => prev + 1)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          Add Component
        </button>
      </div>

      {/* Enhanced Drop Zones Demo */}
      <div className="border border-gray-200 rounded-lg p-6 bg-white">
        <h3 className="text-lg font-semibold mb-4">Enhanced Drop Zones</h3>
        <div className="max-w-2xl">
          <EnhancedDropZones
            componentCount={componentCount}
            onDrop={handleDrop}
            draggedItem={draggedItem}
          />

          {/* Simulate components */}
          {Array.from({ length: componentCount }, (_, index) => (
            <div
              key={index}
              className="bg-gray-100 border border-gray-200 rounded-lg p-4 my-4"
            >
              <div className="text-sm text-gray-600">Component {index + 1}</div>
              <div className="text-gray-800">Sample component content</div>
            </div>
          ))}
        </div>
      </div>

      {/* Individual Drop Zone Components Demo */}
      <div className="border border-gray-200 rounded-lg p-6 bg-white">
        <h3 className="text-lg font-semibold mb-4">Individual Drop Zone Sizes</h3>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Small (48px)</h4>
            <DropZoneComponent
              index={0}
              isActive={false}
              isHovered={false}
              onDrop={handleDrop}
              onDragOver={() => {}}
              size="small"
              showLabel={true}
            />
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Medium (64px)</h4>
            <DropZoneComponent
              index={1}
              isActive={false}
              isHovered={false}
              onDrop={handleDrop}
              onDragOver={() => {}}
              size="medium"
              showLabel={true}
            />
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Large (96px)</h4>
            <DropZoneComponent
              index={2}
              isActive={false}
              isHovered={false}
              onDrop={handleDrop}
              onDragOver={() => {}}
              size="large"
              showLabel={true}
            />
          </div>
        </div>
      </div>

      {/* Drop Zone States Demo */}
      <div className="border border-gray-200 rounded-lg p-6 bg-white">
        <h3 className="text-lg font-semibold mb-4">Drop Zone States</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Default State</h4>
            <DropZoneComponent
              index={0}
              isActive={false}
              isHovered={false}
              onDrop={handleDrop}
              onDragOver={() => {}}
              size="medium"
              showLabel={false}
            />
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Hovered State</h4>
            <DropZoneComponent
              index={1}
              isActive={false}
              isHovered={true}
              onDrop={handleDrop}
              onDragOver={() => {}}
              size="medium"
              showLabel={true}
            />
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Active State</h4>
            <DropZoneComponent
              index={2}
              isActive={true}
              isHovered={false}
              onDrop={handleDrop}
              onDragOver={() => {}}
              size="medium"
              showLabel={true}
            />
          </div>
        </div>
      </div>

      {/* Drop Zone Indicators Demo */}
      <div className="border border-gray-200 rounded-lg p-6 bg-white">
        <h3 className="text-lg font-semibold mb-4">Drop Zone Indicators</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Compact Indicators</h4>
            <div className="space-y-3">
              <div className="p-3 border border-gray-200 rounded">
                <DropZoneIndicator
                  isActive={false}
                  position="center"
                  label="Drop component here"
                  size="compact"
                />
              </div>
              <div className="p-3 border border-gray-200 rounded">
                <DropZoneIndicator
                  isActive={true}
                  position="center"
                  label="Drop component here"
                  size="compact"
                />
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Expanded Indicators</h4>
            <div className="space-y-3">
              <div className="p-3 border border-gray-200 rounded">
                <DropZoneIndicator
                  isActive={false}
                  position="center"
                  label="Drop component here"
                  size="expanded"
                />
              </div>
              <div className="p-3 border border-gray-200 rounded">
                <DropZoneIndicator
                  isActive={true}
                  position="center"
                  label="Drop component here"
                  size="expanded"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Accessibility Features */}
      <div className="border border-gray-200 rounded-lg p-6 bg-white">
        <h3 className="text-lg font-semibold mb-4">Accessibility Features</h3>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-start space-x-2">
            <span className="text-green-600">✓</span>
            <span>All drop zones are keyboard accessible with proper tab order</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="text-green-600">✓</span>
            <span>ARIA labels provide context for screen readers</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="text-green-600">✓</span>
            <span>Visual focus indicators for keyboard navigation</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="text-green-600">✓</span>
            <span>Minimum 48px touch targets for mobile accessibility</span>
          </div>
          <div className="flex items-start space-x-2">
            <span className="text-green-600">✓</span>
            <span>Reduced motion support for users with vestibular disorders</span>
          </div>
        </div>
      </div>
    </div>
  );
};
