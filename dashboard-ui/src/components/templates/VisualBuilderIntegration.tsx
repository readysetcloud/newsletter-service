import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  SparklesIcon,
  CogIcon,
  BeakerIcon,
  EyeIcon
} from '@heroicons/react/24/outline';
import { TemplateBuilder } from './TemplateBuilder';
import { EnhancedVisualBuilder } from './EnhancedVisualBuilder';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../../utils/cn';
import {
  detectBrowserSupport,
  detectDeviceCapabilities,
  determinePerformanceMode,
  applyCompatibilityFixes,
  isBrowserSupported,
  getBrowserCompatibilityMessage
} from '../../utils/crossBrowserCompatibility';
import type { Template } from '../../types/template';

interface VisualBuilderIntegrationProps {
  template?: Template;
  onSave?: (template: Template) => void;
  onCancel?: () => void;
  onPreview?: (template: Template) => void;
  className?: string;
}

interface IntegrationState {
  isInitialized: boolean;
  hasErrors: boolean;
  isLoading: boolean;
  animationsEnabled: boolean;
  performanceMode: 'high' | 'standard' | 'optimized';
  browserSupported: boolean;
  compatibilityMessage?: string;
  useEnhancedBuilder: boolean;
}

/**
 * Visual Builder Integration Component
 *
 * This component provides the main integration layer for the visual builder system,
 * handling browser compatibility, performance optimization, and feature detection.
 * It automatically selects between the enhanced visual builder and fallback options
 * based on browser capabilities.
 */
export const VisualBuilderIntegration: React.FC<VisualBuilderIntegrationProps> = ({
  template,
  onSave,
  onCancel,
  onPreview,
  className
}) => {
  const [integrationState, setIntegrationState] = useState<IntegrationState>({
    isInitialized: false,
    hasErrors: false,
    isLoading: true,
    animationsEnabled: true,
    performanceMode: 'standard',
    browserSupported: true,
    useEnhancedBuilder: true
  });

  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const initializationTimeoutRef = useRef<NodeJS.Timeout>();

  // Initialize integration and check browser compatibility
  useEffect(() => {
    const initializeIntegration = async () => {
      setIntegrationState(prev => ({ ...prev, isLoading: true }));

      try {
        // Detect browser capabilities
        const browserSupport = detectBrowserSupport();
        const deviceCapabilities = detectDeviceCapabilities();

        // Apply compatibility fixes
        applyCompatibilityFixes(browserSupport);

        // Check for reduced motion preference
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Determine performance mode
        const performanceMode = determinePerformanceMode(browserSupport, deviceCapabilities);

        // Check if browser is supported
        const browserSupported = isBrowserSupported(browserSupport);
        const compatibilityMessage = getBrowserCompatibilityMessage(browserSupport);

        // Run integration tests
        const tests = await runIntegrationTests();
        setTestResults(tests);

        // Determine if we should use enhanced builder
        const useEnhancedBuilder = browserSupported &&
                                  browserSupport.dragAndDrop &&
                                  browserSupport.animations &&
                                  Object.values(tests).every(result => result);

        // Initialize with appropriate settings
        setIntegrationState({
          isInitialized: true,
          hasErrors: !browserSupported || Object.values(tests).some(result => !result),
          isLoading: false,
          animationsEnabled: !prefersReducedMotion && browserSupport.animations,
          performanceMode,
          browserSupported,
          compatibilityMessage: compatibilityMessage || undefined,
          useEnhancedBuilder
        });

        // Show success animation if enabled
        if (!prefersReducedMotion && browserSupport.animations && browserSupported) {
          setShowSuccessAnimation(true);
          setTimeout(() => setShowSuccessAnimation(false), 2000);
        }

      } catch (error) {
        console.error('Failed to initialize visual builder integration:', error);
        setIntegrationState(prev => ({
          ...prev,
          hasErrors: true,
          isLoading: false,
          browserSupported: false,
          useEnhancedBuilder: false
        }));
      }
    };

    // Delay initialization to ensure DOM is ready
    initializationTimeoutRef.current = setTimeout(initializeIntegration, 100);

    return () => {
      if (initializationTimeoutRef.current) {
        clearTimeout(initializationTimeoutRef.current);
      }
    };
  }, []);

  // Run integration tests
  const runIntegrationTests = useCallback(async (): Promise<Record<string, boolean>> => {
    const tests: Record<string, boolean> = {};

    // Test drag and drop functionality
    try {
      const testDiv = document.createElement('div');
      testDiv.draggable = true;
      const dragEvent = new DragEvent('dragstart', { bubbles: true });
      tests.dragAndDrop = testDiv.dispatchEvent(dragEvent);
    } catch {
      tests.dragAndDrop = false;
    }

    // Test CSS animations
    tests.animations = CSS.supports('animation', 'none');

    // Test flexbox layout
    tests.flexbox = CSS.supports('display', 'flex');

    // Test CSS Grid
    tests.grid = CSS.supports('display', 'grid');

    // Test local storage
    try {
      localStorage.setItem('test', 'test');
      localStorage.removeItem('test');
      tests.localStorage = true;
    } catch {
      tests.localStorage = false;
    }

    // Test variable picker functionality
    tests.variablePicker = true; // Assume true for now

    // Test drop zone enhancements
    tests.enhancedDropZones = tests.dragAndDrop && tests.animations;

    return tests;
  }, []);

  // Enhanced save handler with animations
  const handleSave = useCallback(async (template: Template) => {
    if (integrationState.animationsEnabled) {
      // Add saving animation class
      containerRef.current?.classList.add('saving-animation');
    }

    try {
      await onSave?.(template);

      // Show success animation
      if (integrationState.animationsEnabled) {
        setShowSuccessAnimation(true);
        containerRef.current?.classList.add('success-animation');

        setTimeout(() => {
          setShowSuccessAnimation(false);
          containerRef.current?.classList.remove('success-animation', 'saving-animation');
        }, 1500);
      }

    } catch (error) {
      containerRef.current?.classList.remove('saving-animation');
      containerRef.current?.classList.add('error-animation');

      setTimeout(() => {
        containerRef.current?.classList.remove('error-animation');
      }, 500);

      throw error;
    }
  }, [integrationState.animationsEnabled, onSave]);

  // Error recovery handler
  const handleErrorRecovery = useCallback(() => {
    setIntegrationState(prev => ({
      ...prev,
      hasErrors: false,
      useEnhancedBuilder: false // Fallback to basic builder
    }));
  }, []);

  // Toggle between enhanced and basic builder
  const handleToggleBuilder = useCallback(() => {
    setIntegrationState(prev => ({
      ...prev,
      useEnhancedBuilder: !prev.useEnhancedBuilder
    }));
  }, []);

  // Render loading state
  if (integrationState.isLoading && !integrationState.isInitialized) {
    return (
      <div className={cn('flex items-center justify-center min-h-96', className)}>
        <div className={cn(
          'text-center transition-all duration-300',
          integrationState.animationsEnabled && 'animate-fade-in-scale'
        )}>
          <ArrowPathIcon className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">Initializing Visual Builder...</p>
          <div className="mt-2 text-sm text-gray-500">
            Checking browser compatibility and performance...
          </div>
        </div>
      </div>
    );
  }

  // Render error state with recovery options
  if (integrationState.hasErrors && !integrationState.useEnhancedBuilder) {
    return (
      <div className={cn('space-y-6', className)}>
        <Card className="p-6 border-yellow-200 bg-yellow-50">
          <div className="flex items-center space-x-3 mb-4">
            <ExclamationTriangleIcon className="w-6 h-6 text-yellow-500" />
            <h3 className="text-lg font-semibold text-yellow-900">
              Enhanced Features Limited
            </h3>
          </div>

          {integrationState.compatibilityMessage && (
            <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded-md">
              <p className="text-yellow-800 text-sm">
                {integrationState.compatibilityMessage}
              </p>
            </div>
          )}

          <p className="text-yellow-700 mb-4">
            Some enhanced visual builder features are not available in your browser.
            You can still use the template builder with basic functionality.
          </p>

          <div className="flex space-x-3">
            <Button onClick={handleErrorRecovery} variant="primary">
              Use Basic Builder
            </Button>
            <Button onClick={onCancel} variant="outline">
              Cancel
            </Button>
          </div>
        </Card>

        {/* Integration Test Results */}
        <Card className="p-6">
          <h4 className="font-semibold mb-3 flex items-center">
            <BeakerIcon className="w-5 h-5 mr-2" />
            Browser Compatibility Results
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {Object.entries(testResults).map(([test, passed]) => (
              <div key={test} className="flex items-center space-x-2">
                {passed ? (
                  <CheckCircleIcon className="w-4 h-4 text-green-500" />
                ) : (
                  <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
                )}
                <span className="capitalize">{test.replace(/([A-Z])/g, ' $1')}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative min-h-screen transition-all duration-300',
        integrationState.performanceMode === 'optimized' && 'performance-optimized',
        integrationState.animationsEnabled && 'animations-enabled',
        className
      )}
    >
      {/* Success Animation Overlay */}
      {showSuccessAnimation && integrationState.animationsEnabled && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-20 pointer-events-none animate-fade-in">
          <div className="bg-white rounded-full p-6 shadow-2xl animate-bounce-in">
            <CheckCircleIcon className="w-16 h-16 text-green-500 animate-zoom-in" />
          </div>
        </div>
      )}

      {/* Performance Mode Indicator */}
      {integrationState.performanceMode === 'optimized' && (
        <div className="fixed top-4 right-4 z-40 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center space-x-2 animate-slide-down">
          <SparklesIcon className="w-4 h-4" />
          <span>Performance Mode</span>
        </div>
      )}

      {/* High Performance Mode Indicator */}
      {integrationState.performanceMode === 'high' && (
        <div className="fixed top-4 right-4 z-40 bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm flex items-center space-x-2 animate-slide-down">
          <SparklesIcon className="w-4 h-4" />
          <span>High Performance Mode</span>
        </div>
      )}

      {/* Builder Mode Toggle */}
      <div className="fixed top-4 left-4 z-40">
        <div className="flex items-center space-x-2 bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleBuilder}
            className="flex items-center space-x-2"
          >
            <EyeIcon className="w-4 h-4" />
            <span className="text-sm">
              {integrationState.useEnhancedBuilder ? 'Enhanced' : 'Basic'} Builder
            </span>
          </Button>
        </div>
      </div>

      {/* Main Template Builder */}
      <div className={cn(
        'transition-all duration-500',
        integrationState.animationsEnabled && 'animate-fade-in-scale'
      )}>
        {integrationState.useEnhancedBuilder ? (
          <EnhancedVisualBuilder
            template={template}
            onSave={handleSave}
            onCancel={onCancel}
            onPreview={onPreview}
            className={cn(
              'enhanced-transition',
              integrationState.performanceMode === 'optimized' && 'performance-mode'
            )}
          />
        ) : (
          <TemplateBuilder
            template={template}
            onSave={handleSave}
            onCancel={onCancel}
            onPreview={onPreview}
            className={cn(
              'enhanced-transition',
              integrationState.performanceMode === 'optimized' && 'performance-mode'
            )}
          />
        )}
      </div>

      {/* Integration Status */}
      <div className="fixed bottom-4 left-4 z-30">
        <div className={cn(
          'bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 flex items-center space-x-2 text-sm text-gray-600 transition-all duration-300',
          integrationState.animationsEnabled && 'animate-slide-up'
        )}>
          <div className={cn(
            'w-2 h-2 rounded-full',
            integrationState.hasErrors ? 'bg-yellow-400' : 'bg-green-400',
            integrationState.animationsEnabled && 'animate-pulse'
          )}></div>
          <span>
            {integrationState.useEnhancedBuilder ? 'Enhanced Visual Builder' : 'Basic Template Builder'}
          </span>
          <CogIcon className="w-4 h-4" />
        </div>
      </div>

      {/* Enhanced CSS Styles */}
      <style>{`
        .performance-optimized {
          will-change: auto;
        }

        .performance-optimized * {
          will-change: auto;
        }

        .performance-mode .drop-zone-transition,
        .performance-mode .enhanced-drop-zone-item,
        .performance-mode .enhanced-transition {
          transition: none !important;
          animation: none !important;
        }

        .saving-animation {
          opacity: 0.8;
          transform: scale(0.98);
          transition: all 0.3s ease-in-out;
        }

        .success-animation {
          animation: success-pulse 0.6s ease-out;
        }

        .error-animation {
          animation: error-shake 0.5s ease-in-out;
        }

        @keyframes success-pulse {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }

        @keyframes error-shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
          20%, 40%, 60%, 80% { transform: translateX(2px); }
        }

        @media (prefers-reduced-motion: reduce) {
          .performance-optimized *,
          .performance-mode *,
          .saving-animation,
          .success-animation,
          .error-animation {
            animation: none !important;
            transition: none !important;
          }

          .animate-pulse,
          .animate-spin,
          .animate-fade-in,
          .animate-fade-in-scale,
          .animate-bounce-in,
          .animate-zoom-in,
          .animate-slide-down,
          .animate-slide-up {
            animation: none !important;
          }
        }

        /* Cross-browser compatibility fixes */
        .enhanced-transition {
          -webkit-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          -moz-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          -ms-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          -o-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }

        .animations-enabled .animate-fade-in-scale {
          animation: fadeInScale 0.5s ease-out;
        }

        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export default VisualBuilderIntegration;
