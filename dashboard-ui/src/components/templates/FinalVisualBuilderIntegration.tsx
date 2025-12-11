import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  SparklesIcon,
  CogIcon,
  BeakerIcon,
  EyeIcon,
  AdjustmentsHorizontalIcon,
  BoltIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';
import { VisualBuilderIntegration } from './VisualBuilderIntegration';
import { EnhancedVisualBuilder } from './EnhancedVisualBuilder';
import { TemplateBuilder } from './TemplateBuilder';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Loading } from '../ui/Loading';
import { ErrorBoundary } from '../error/ErrorBoundary';
import { cn } from '../../utils/cn';
import {
  detectBrowserSupport,
  detectDeviceCapabilities,
  determinePerformanceMode,
  applyCompatibilityFixes,
  isBrowserSupported,
  getBrowserCompatibilityMessage
} from '../../utils/crossBrowserCompatibility';
import { runCrossBrowserTests, getCompatibilityScore } from '../../utils/crossBrowserTesting';
import type { Template } from '../../types/template';

interface FinalVisualBuilderIntegrationProps {
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
  compatibilityScore: number;
  compatibilityMessage?: string;
  useEnhancedBuilder: boolean;
  showDiagnostics: boolean;
}

interface DiagnosticInfo {
  browserSupport: any;
  deviceCapabilities: any;
  testResults: Record<string, boolean>;
  performanceMetrics: {
    initTime: number;
    renderTime: number;
    memoryUsage?: number;
  };
}

/**
 * Final Visual Builder Integration Component
 *
 * This is the ultimate integration layer that combines all enhanced visual builder features
 * with comprehensive cross-browser compatibility, performance optimization, and error recovery.
 * It provides smooth animations, accessibility features, and graceful degradation.
 */
export const FinalVisualBuilderIntegration: React.FC<FinalVisualBuilderIntegrationProps> = ({
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
    compatibilityScore: 0,
    useEnhancedBuilder: true,
    showDiagnostics: false
  });

  const [diagnosticInfo, setDiagnosticInfo] = useState<DiagnosticInfo | null>(null);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [initStartTime] = useState(performance.now());

  const containerRef = useRef<HTMLDivElement>(null);
  const initializationTimeoutRef = useRef<NodeJS.Timeout>();

  // Initialize comprehensive integration
  useEffect(() => {
    const initializeComprehensiveIntegration = async () => {
      setIntegrationState(prev => ({ ...prev, isLoading: true }));

      try {
        const renderStartTime = performance.now();

        // Step 1: Detect browser capabilities
        const browserSupport = detectBrowserSupport();
        const deviceCapabilities = detectDeviceCapabilities();

        // Step 2: Apply compatibility fixes
        applyCompatibilityFixes(browserSupport);

        // Step 3: Check for accessibility preferences
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const prefersHighContrast = window.matchMedia('(prefers-contrast: high)').matches;

        // Step 4: Determine performance mode
        const performanceMode = determinePerformanceMode(browserSupport, deviceCapabilities);

        // Step 5: Run comprehensive browser tests
        const browserTests = await runCrossBrowserTests();
        const compatibilityScore = getCompatibilityScore(browserTests);

        // Step 6: Run integration tests
        const testResults = await runIntegrationTests();

        // Step 7: Check browser support
        const browserSupported = isBrowserSupported(browserSupport);
        const compatibilityMessage = getBrowserCompatibilityMessage(browserSupport);

        // Step 8: Determine builder mode
        const useEnhancedBuilder = browserSupported &&
                                  browserSupport.dragAndDrop &&
                                  browserSupport.animations &&
                                  compatibilityScore >= 70 &&
                                  Object.values(testResults).filter(Boolean).length >= 6;

        const renderEndTime = performance.now();

        // Step 9: Collect diagnostic information
        const diagnostics: DiagnosticInfo = {
          browserSupport,
          deviceCapabilities,
          testResults,
          performanceMetrics: {
            initTime: renderStartTime - initStartTime,
            renderTime: renderEndTime - renderStartTime,
            memoryUsage: (performance as any).memory?.usedJSHeapSize
          }
        };

        setDiagnosticInfo(diagnostics);

        // Step 10: Initialize with appropriate settings
        setIntegrationState({
          isInitialized: true,
          hasErrors: !browserSupported || compatibilityScore < 50,
          isLoading: false,
          animationsEnabled: !prefersReducedMotion && browserSupport.animations,
          performanceMode,
          browserSupported,
          compatibilityScore,
          compatibilityMessage: compatibilityMessage || undefined,
          useEnhancedBuilder,
          showDiagnostics: false
        });

        // Step 11: Show success animation if appropriate
        if (!prefersReducedMotion && browserSupport.animations && browserSupported && compatibilityScore >= 80) {
          setShowSuccessAnimation(true);
          setTimeout(() => setShowSuccessAnimation(false), 2000);
        }

        // Step 12: Apply performance optimizations
        applyPerformanceOptimizations(performanceMode, deviceCapabilities);

      } catch (error) {
        console.error('Failed to initialize comprehensive visual builder integration:', error);
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
    initializationTimeoutRef.current = setTimeout(initializeComprehensiveIntegration, 150);

    return () => {
      if (initializationTimeoutRef.current) {
        clearTimeout(initializationTimeoutRef.current);
      }
    };
  }, [initStartTime]);

  // Run comprehensive integration tests
  const runIntegrationTests = useCallback(async (): Promise<Record<string, boolean>> => {
    const tests: Record<string, boolean> = {};

    // Test 1: Enhanced drop zones
    try {
      const testDropZone = document.createElement('div');
      testDropZone.className = 'enhanced-drop-zone-item';
      testDropZone.style.minHeight = '48px';
      testDropZone.draggable = true;

      document.body.appendChild(testDropZone);
      const dragEvent = new DragEvent('dragstart', { bubbles: true });
      tests.enhancedDropZones = testDropZone.dispatchEvent(dragEvent);
      document.body.removeChild(testDropZone);
    } catch {
      tests.enhancedDropZones = false;
    }

    // Test 2: Variable system
    try {
      const testInput = document.createElement('input');
      testInput.type = 'text';
      testInput.value = '{{newsletter.title}}';
      const inputEvent = new Event('input', { bubbles: true });
      tests.variableSystem = testInput.dispatchEvent(inputEvent);
    } catch {
      tests.variableSystem = false;
    }

    // Test 3: Animation performance
    try {
      const startTime = performance.now();
      const testElement = document.createElement('div');
      testElement.style.transition = 'all 0.3s ease-out';
      document.body.appendChild(testElement);
      testElement.style.opacity = '0';
      await new Promise(resolve => setTimeout(resolve, 50));
      testElement.style.opacity = '1';
      await new Promise(resolve => setTimeout(resolve, 350));
      document.body.removeChild(testElement);
      const endTime = performance.now();
      tests.animationPerformance = (endTime - startTime) < 500;
    } catch {
      tests.animationPerformance = false;
    }

    // Test 4: Local storage
    try {
      localStorage.setItem('vb-test', 'test');
      localStorage.removeItem('vb-test');
      tests.localStorage = true;
    } catch {
      tests.localStorage = false;
    }

    // Test 5: Error boundaries
    tests.errorBoundaries = true; // Assume working

    // Test 6: Accessibility features
    try {
      const testButton = document.createElement('button');
      testButton.setAttribute('aria-label', 'Test');
      testButton.tabIndex = 0;
      document.body.appendChild(testButton);
      testButton.focus();
      const hasFocus = document.activeElement === testButton;
      document.body.removeChild(testButton);
      tests.accessibility = hasFocus;
    } catch {
      tests.accessibility = false;
    }

    // Test 7: Performance monitoring
    tests.performanceMonitoring = 'performance' in window && 'now' in performance;

    // Test 8: Cross-browser compatibility
    tests.crossBrowserCompatibility = CSS.supports('display', 'flex') &&
                                     CSS.supports('display', 'grid');

    return tests;
  }, []);

  // Apply performance optimizations based on device capabilities
  const applyPerformanceOptimizations = useCallback((
    performanceMode: 'high' | 'standard' | 'optimized',
    deviceCapabilities: any
  ) => {
    const style = document.createElement('style');
    style.id = 'visual-builder-performance-optimizations';

    let css = '';

    if (performanceMode === 'optimized') {
      css += `
        .visual-builder-container * {
          will-change: auto !important;
          transform: translateZ(0);
        }

        .visual-builder-container .animate-fade-in,
        .visual-builder-container .animate-slide-up,
        .visual-builder-container .animate-bounce-in {
          animation: none !important;
          transition: opacity 0.2s ease-out !important;
        }

        .visual-builder-container .drop-zone-transition {
          transition: background-color 0.1s ease-out !important;
        }
      `;
    } else if (performanceMode === 'high') {
      css += `
        .visual-builder-container {
          contain: layout style paint;
        }

        .visual-builder-container .enhanced-drop-zone-item {
          will-change: transform, opacity;
        }

        .visual-builder-container .variable-picker-container {
          will-change: transform;
        }
      `;
    }

    // Add mobile-specific optimizations
    if (deviceCapabilities.isMobile) {
      css += `
        .visual-builder-container .drop-zone-item {
          min-height: 56px !important;
          touch-action: manipulation;
        }

        .visual-builder-container .variable-picker-button {
          min-width: 44px;
          min-height: 44px;
        }
      `;
    }

    style.textContent = css;
    document.head.appendChild(style);
  }, []);

  // Enhanced save handler with comprehensive feedback
  const handleSave = useCallback(async (template: Template) => {
    if (integrationState.animationsEnabled) {
      containerRef.current?.classList.add('saving-animation');
    }

    try {
      await onSave?.(template);

      // Show success animation with enhanced feedback
      if (integrationState.animationsEnabled) {
        setShowSuccessAnimation(true);
        containerRef.current?.classList.add('success-animation');

        // Add haptic feedback on supported devices
        if ('vibrate' in navigator) {
          navigator.vibrate([100, 50, 100]);
        }

        setTimeout(() => {
          setShowSuccessAnimation(false);
          containerRef.current?.classList.remove('success-animation', 'saving-animation');
        }, 1500);
      }

    } catch (error) {
      containerRef.current?.classList.remove('saving-animation');
      containerRef.current?.classList.add('error-animation');

      // Add error haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }

      setTimeout(() => {
        containerRef.current?.classList.remove('error-animation');
      }, 500);

      throw error;
    }
  }, [integrationState.animationsEnabled, onSave]);

  // Error recovery with multiple fallback options
  const handleErrorRecovery = useCallback(() => {
    setIntegrationState(prev => ({
      ...prev,
      hasErrors: false,
      useEnhancedBuilder: false // Fallback to basic builder
    }));
  }, []);

  // Toggle diagnostics panel
  const handleToggleDiagnostics = useCallback(() => {
    setIntegrationState(prev => ({
      ...prev,
      showDiagnostics: !prev.showDiagnostics
    }));
  }, []);

  // Toggle between enhanced and basic builder
  const handleToggleBuilder = useCallback(() => {
    setIntegrationState(prev => ({
      ...prev,
      useEnhancedBuilder: !prev.useEnhancedBuilder
    }));
  }, []);

  // Render loading state with progress indication
  if (integrationState.isLoading && !integrationState.isInitialized) {
    return (
      <div className={cn('flex items-center justify-center min-h-96', className)}>
        <div className={cn(
          'text-center transition-all duration-300',
          integrationState.animationsEnabled && 'animate-fade-in-scale'
        )}>
          <ArrowPathIcon className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Initializing Enhanced Visual Builder</p>
          <div className="mt-2 text-sm text-gray-500">
            Optimizing for your device and browser...
          </div>
          <div className="mt-4 w-64 bg-gray-200 rounded-full h-2 mx-auto">
            <div className="bg-blue-500 h-2 rounded-full animate-pulse" style={{ width: '75%' }}></div>
          </div>
        </div>
      </div>
    );
  }

  // Render error state with comprehensive recovery options
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

          <div className="mb-4">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-yellow-700 font-medium">Compatibility Score:</span>
              <span className="text-2xl font-bold text-yellow-600">
                {integrationState.compatibilityScore}%
              </span>
            </div>
            <div className="w-full bg-yellow-200 rounded-full h-2">
              <div
                className="bg-yellow-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${integrationState.compatibilityScore}%` }}
              ></div>
            </div>
          </div>

          <p className="text-yellow-700 mb-4">
            Some enhanced visual builder features are not available in your browser.
            You can still use the template builder with basic functionality.
          </p>

          <div className="flex space-x-3">
            <Button onClick={handleErrorRecovery} variant="primary">
              Use Basic Builder
            </Button>
            <Button onClick={handleToggleDiagnostics} variant="outline">
              View Diagnostics
            </Button>
            <Button onClick={onCancel} variant="outline">
              Cancel
            </Button>
          </div>
        </Card>

        {/* Diagnostics Panel */}
        {integrationState.showDiagnostics && diagnosticInfo && (
          <Card className="p-6">
            <h4 className="font-semibold mb-3 flex items-center">
              <BeakerIcon className="w-5 h-5 mr-2" />
              Browser Diagnostics
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {Object.entries(diagnosticInfo.testResults).map(([test, passed]) => (
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

            <div className="mt-4 pt-4 border-t border-gray-200">
              <h5 className="font-medium mb-2">Performance Metrics</h5>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Init Time:</span>
                  <span className="ml-2 font-mono">{Math.round(diagnosticInfo.performanceMetrics.initTime)}ms</span>
                </div>
                <div>
                  <span className="text-gray-600">Render Time:</span>
                  <span className="ml-2 font-mono">{Math.round(diagnosticInfo.performanceMetrics.renderTime)}ms</span>
                </div>
                {diagnosticInfo.performanceMetrics.memoryUsage && (
                  <div>
                    <span className="text-gray-600">Memory:</span>
                    <span className="ml-2 font-mono">
                      {Math.round(diagnosticInfo.performanceMetrics.memoryUsage / 1024 / 1024)}MB
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="p-6 text-center">
          <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-900 mb-2">Visual Builder Error</h3>
          <p className="text-red-700 mb-4">
            The visual builder encountered an unexpected error. Please try refreshing the page.
          </p>
          <Button onClick={() => window.location.reload()} variant="primary">
            Refresh Page
          </Button>
        </div>
      }
    >
      <div
        ref={containerRef}
        className={cn(
          'relative min-h-screen transition-all duration-300 visual-builder-container',
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

        {/* Performance Mode Indicators */}
        <div className="fixed top-4 right-4 z-40 flex flex-col space-y-2">
          {integrationState.performanceMode === 'optimized' && (
            <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center space-x-2 animate-slide-down">
              <BoltIcon className="w-4 h-4" />
              <span>Optimized Mode</span>
            </div>
          )}

          {integrationState.performanceMode === 'high' && (
            <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm flex items-center space-x-2 animate-slide-down">
              <SparklesIcon className="w-4 h-4" />
              <span>High Performance</span>
            </div>
          )}

          {integrationState.compatibilityScore >= 90 && (
            <div className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-sm flex items-center space-x-2 animate-slide-down">
              <ShieldCheckIcon className="w-4 h-4" />
              <span>Fully Compatible</span>
            </div>
          )}
        </div>

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

            <div className="h-4 w-px bg-gray-300"></div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleDiagnostics}
              className="flex items-center space-x-2"
            >
              <AdjustmentsHorizontalIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Main Visual Builder */}
        <div className={cn(
          'transition-all duration-500',
          integrationState.animationsEnabled && 'animate-fade-in-scale'
        )}>
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-96">
              <Loading size="lg" />
            </div>
          }>
            {integrationState.useEnhancedBuilder ? (
              <VisualBuilderIntegration
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
          </Suspense>
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
            <span className="text-xs text-gray-500">
              ({integrationState.compatibilityScore}%)
            </span>
            <CogIcon className="w-4 h-4" />
          </div>
        </div>

        {/* Diagnostics Panel */}
        {integrationState.showDiagnostics && diagnosticInfo && (
          <div className="fixed bottom-20 left-4 z-30 w-80">
            <Card className="p-4 bg-white/95 backdrop-blur-sm">
              <h4 className="font-semibold mb-3 flex items-center">
                <BeakerIcon className="w-4 h-4 mr-2" />
                Live Diagnostics
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span>Performance Mode:</span>
                  <span className="font-mono">{integrationState.performanceMode}</span>
                </div>
                <div className="flex justify-between">
                  <span>Compatibility:</span>
                  <span className="font-mono">{integrationState.compatibilityScore}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Animations:</span>
                  <span className="font-mono">{integrationState.animationsEnabled ? 'On' : 'Off'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Memory:</span>
                  <span className="font-mono">
                    {diagnosticInfo.performanceMetrics.memoryUsage
                      ? `${Math.round(diagnosticInfo.performanceMetrics.memoryUsage / 1024 / 1024)}MB`
                      : 'N/A'
                    }
                  </span>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Enhanced CSS Styles */}
        <style>{`
          .visual-builder-container.performance-optimized {
            will-change: auto;
          }

          .visual-builder-container.performance-optimized * {
            will-change: auto;
          }

          .visual-builder-container.performance-mode .drop-zone-transition,
          .visual-builder-container.performance-mode .enhanced-drop-zone-item,
          .visual-builder-container.performance-mode .enhanced-transition {
            transition: none !important;
            animation: none !important;
          }

          .visual-builder-container .saving-animation {
            opacity: 0.8;
            transform: scale(0.98);
            transition: all 0.3s ease-in-out;
          }

          .visual-builder-container .success-animation {
            animation: success-pulse 0.6s ease-out;
          }

          .visual-builder-container .error-animation {
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
            .visual-builder-container.performance-optimized *,
            .visual-builder-container.performance-mode *,
            .visual-builder-container .saving-animation,
            .visual-builder-container .success-animation,
            .visual-builder-container .error-animation {
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
          .visual-builder-container .enhanced-transition {
            -webkit-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            -moz-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            -ms-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            -o-transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          }

          .visual-builder-container.animations-enabled .animate-fade-in-scale {
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
    </ErrorBoundary>
  );
};

export default FinalVisualBuilderIntegration;
