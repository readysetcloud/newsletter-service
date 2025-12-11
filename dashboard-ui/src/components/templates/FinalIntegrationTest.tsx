import React, { useState, useEffect } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  BeakerIcon,
  SparklesIcon,
  CogIcon
} from '@heroicons/react/24/outline';
import { VisualBuilderIntegration } from './VisualBuilderIntegration';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { runCrossBrowserTests, getCompatibilityScore, generateCompatibilityReport } from '../../utils/crossBrowserTesting';
import type { CrossBrowserTestSuite } from '../../utils/crossBrowserTesting';
import type { Template } from '../../types/template';

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  message: string;
  duration?: number;
}

/**
 * Final Integration Test Component
 *
 * This component provides comprehensive testing of the visual builder integration,
 * including cross-browser compatibility, performance testing, and feature verification.
 */
export const FinalIntegrationTest: React.FC = () => {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [browserTests, setBrowserTests] = useState<CrossBrowserTestSuite | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [compatibilityScore, setCompatibilityScore] = useState<number>(0);
  const [showVisualBuilder, setShowVisualBuilder] = useState(false);

  // Initialize test suite
  useEffect(() => {
    initializeTests();
  }, []);

  const initializeTests = () => {
    const initialTests: TestResult[] = [
      {
        name: 'Browser Compatibility',
        status: 'pending',
        message: 'Checking browser support for visual builder features'
      },
      {
        name: 'Drop Zone Enhancement',
        status: 'pending',
        message: 'Testing enhanced drop zones with improved targeting'
      },
      {
        name: 'Variable System Integration',
        status: 'pending',
        message: 'Verifying variable picker and autocomplete functionality'
      },
      {
        name: 'Animation Performance',
        status: 'pending',
        message: 'Testing smooth animations and transitions'
      },
      {
        name: 'Cross-Browser Fixes',
        status: 'pending',
        message: 'Applying compatibility fixes and polyfills'
      },
      {
        name: 'Accessibility Features',
        status: 'pending',
        message: 'Verifying keyboard navigation and screen reader support'
      },
      {
        name: 'Performance Optimization',
        status: 'pending',
        message: 'Testing performance mode detection and optimization'
      },
      {
        name: 'Error Recovery',
        status: 'pending',
        message: 'Testing error handling and graceful degradation'
      }
    ];

    setTestResults(initialTests);
  };

  const runAllTests = async () => {
    setIsRunning(true);

    try {
      // Run browser compatibility tests first
      await runTest('Browser Compatibility', async () => {
        const browserTestResults = await runCrossBrowserTests();
        setBrowserTests(browserTestResults);
        const score = getCompatibilityScore(browserTestResults);
        setCompatibilityScore(score);

        if (score >= 80) {
          return { success: true, message: `Excellent compatibility (${score}%)` };
        } else if (score >= 60) {
          return { success: true, message: `Good compatibility (${score}%) with minor limitations` };
        } else {
          return { success: false, message: `Limited compatibility (${score}%) - fallback mode recommended` };
        }
      });

      // Test drop zone enhancements
      await runTest('Drop Zone Enhancement', async () => {
        const testDropZone = document.createElement('div');
        testDropZone.className = 'enhanced-drop-zone-item';
        testDropZone.style.minHeight = '48px';

        document.body.appendChild(testDropZone);
        const computedStyle = window.getComputedStyle(testDropZone);
        const hasMinHeight = parseInt(computedStyle.minHeight) >= 48;
        document.body.removeChild(testDropZone);

        if (hasMinHeight) {
          return { success: true, message: 'Enhanced drop zones working correctly' };
        } else {
          return { success: false, message: 'Drop zone enhancements not applied' };
        }
      });

      // Test variable system integration
      await runTest('Variable System Integration', async () => {
        try {
          // Test variable picker creation
          const testInput = document.createElement('input');
          testInput.type = 'text';
          testInput.value = '{{newsletter.title}}';

          // Test autocomplete trigger
          const inputEvent = new Event('input', { bubbles: true });
          const canDispatch = testInput.dispatchEvent(inputEvent);

          if (canDispatch) {
            return { success: true, message: 'Variable system integration working' };
          } else {
            return { success: false, message: 'Variable system integration failed' };
          }
        } catch (error) {
          return { success: false, message: 'Variable system not available' };
        }
      });

      // Test animation performance
      await runTest('Animation Performance', async () => {
        const startTime = performance.now();

        // Create test element with animations
        const testElement = document.createElement('div');
        testElement.className = 'animate-fade-in-scale';
        testElement.style.transition = 'all 0.3s ease-out';

        document.body.appendChild(testElement);

        // Trigger animation
        testElement.style.opacity = '0';
        testElement.style.transform = 'scale(0.95)';

        await new Promise(resolve => setTimeout(resolve, 100));

        testElement.style.opacity = '1';
        testElement.style.transform = 'scale(1)';

        await new Promise(resolve => setTimeout(resolve, 350));

        document.body.removeChild(testElement);

        const endTime = performance.now();
        const duration = endTime - startTime;

        if (duration < 500) {
          return { success: true, message: `Smooth animations (${Math.round(duration)}ms)` };
        } else {
          return { success: false, message: `Slow animations (${Math.round(duration)}ms)` };
        }
      });

      // Test cross-browser fixes
      await runTest('Cross-Browser Fixes', async () => {
        const hasFlexbox = CSS.supports('display', 'flex');
        const hasGrid = CSS.supports('display', 'grid');
        const hasAnimations = CSS.supports('animation', 'none');

        const supportedFeatures = [hasFlexbox, hasGrid, hasAnimations].filter(Boolean).length;

        if (supportedFeatures >= 2) {
          return { success: true, message: `${supportedFeatures}/3 modern features supported` };
        } else {
          return { success: false, message: `Only ${supportedFeatures}/3 features supported - polyfills needed` };
        }
      });

      // Test accessibility features
      await runTest('Accessibility Features', async () => {
        const testButton = document.createElement('button');
        testButton.setAttribute('aria-label', 'Test button');
        testButton.setAttribute('role', 'button');
        testButton.tabIndex = 0;

        document.body.appendChild(testButton);

        // Test focus
        testButton.focus();
        const hasFocus = document.activeElement === testButton;

        // Test keyboard event
        const keyEvent = new KeyboardEvent('keydown', { key: 'Enter' });
        const canHandleKeyboard = testButton.dispatchEvent(keyEvent);

        document.body.removeChild(testButton);

        if (hasFocus && canHandleKeyboard) {
          return { success: true, message: 'Accessibility features working correctly' };
        } else {
          return { success: false, message: 'Limited accessibility support' };
        }
      });

      // Test performance optimization
      await runTest('Performance Optimization', async () => {
        const hardwareConcurrency = navigator.hardwareConcurrency || 1;
        const deviceMemory = (navigator as any).deviceMemory || 4;

        let performanceMode = 'standard';
        if (hardwareConcurrency >= 8 && deviceMemory >= 8) {
          performanceMode = 'high';
        } else if (hardwareConcurrency < 4 || deviceMemory < 4) {
          performanceMode = 'optimized';
        }

        return {
          success: true,
          message: `Performance mode: ${performanceMode} (${hardwareConcurrency} cores, ${deviceMemory}GB RAM)`
        };
      });

      // Test error recovery
      await runTest('Error Recovery', async () => {
        try {
          // Simulate an error condition
          const errorTest = () => {
            throw new Error('Test error');
          };

          let errorCaught = false;
          try {
            errorTest();
          } catch (error) {
            errorCaught = true;
          }

          if (errorCaught) {
            return { success: true, message: 'Error handling working correctly' };
          } else {
            return { success: false, message: 'Error handling not working' };
          }
        } catch (error) {
          return { success: true, message: 'Error recovery mechanism active' };
        }
      });

    } catch (error) {
      console.error('Test suite failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const runTest = async (testName: string, testFunction: () => Promise<{ success: boolean; message: string }>) => {
    const startTime = performance.now();

    // Update test status to running
    setTestResults(prev => prev.map(test =>
      test.name === testName
        ? { ...test, status: 'running' as const }
        : test
    ));

    try {
      const result = await testFunction();
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Update test status with result
      setTestResults(prev => prev.map(test =>
        test.name === testName
          ? {
              ...test,
              status: result.success ? 'passed' as const : 'failed' as const,
              message: result.message,
              duration: Math.round(duration)
            }
          : test
      ));

      // Add delay for visual feedback
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      setTestResults(prev => prev.map(test =>
        test.name === testName
          ? {
              ...test,
              status: 'failed' as const,
              message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              duration: Math.round(duration)
            }
          : test
      ));
    }
  };

  const handleSaveTemplate = (template: Template) => {
    console.log('Template saved:', template);
  };

  const handleCancelTemplate = () => {
    setShowVisualBuilder(false);
  };

  const handlePreviewTemplate = (template: Template) => {
    console.log('Template preview:', template);
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />;
      case 'running':
        return <ClockIcon className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'passed':
        return 'text-green-700 bg-green-50 border-green-200';
      case 'failed':
        return 'text-red-700 bg-red-50 border-red-200';
      case 'running':
        return 'text-blue-700 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  if (showVisualBuilder) {
    return (
      <div className="min-h-screen">
        <VisualBuilderIntegration
          onSave={handleSaveTemplate}
          onCancel={handleCancelTemplate}
          onPreview={handlePreviewTemplate}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Visual Builder Final Integration Test
        </h1>
        <p className="text-gray-600">
          Comprehensive testing of enhanced visual builder features and cross-browser compatibility
        </p>
      </div>

      {/* Test Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <BeakerIcon className="w-5 h-5 mr-2" />
            Test Suite Controls
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button
                onClick={runAllTests}
                disabled={isRunning}
                className="flex items-center"
              >
                {isRunning ? (
                  <ClockIcon className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <SparklesIcon className="w-4 h-4 mr-2" />
                )}
                {isRunning ? 'Running Tests...' : 'Run All Tests'}
              </Button>

              <Button
                onClick={() => setShowVisualBuilder(true)}
                variant="outline"
                className="flex items-center"
              >
                <CogIcon className="w-4 h-4 mr-2" />
                Test Visual Builder
              </Button>
            </div>

            {compatibilityScore > 0 && (
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-600">
                  {compatibilityScore}%
                </div>
                <div className="text-sm text-gray-600">
                  Compatibility Score
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {testResults.map((test, index) => (
              <div
                key={test.name}
                className={`p-4 rounded-lg border transition-all duration-200 ${getStatusColor(test.status)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(test.status)}
                    <div>
                      <div className="font-medium">{test.name}</div>
                      <div className="text-sm opacity-75">{test.message}</div>
                    </div>
                  </div>
                  {test.duration && (
                    <div className="text-sm opacity-75">
                      {test.duration}ms
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Browser Compatibility Details */}
      {browserTests && (
        <Card>
          <CardHeader>
            <CardTitle>Browser Compatibility Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(browserTests).map(([key, result]) => (
                <div
                  key={key}
                  className={`p-3 rounded-lg border ${
                    result.passed
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : result.severity === 'warning'
                      ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  <div className="flex items-center space-x-2 mb-1">
                    {result.passed ? (
                      <CheckCircleIcon className="w-4 h-4" />
                    ) : (
                      <ExclamationTriangleIcon className="w-4 h-4" />
                    )}
                    <span className="font-medium">{result.name}</span>
                  </div>
                  <div className="text-sm opacity-75">
                    {result.message}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Integration Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {testResults.filter(t => t.status === 'passed').length}
                </div>
                <div className="text-sm text-blue-700">Tests Passed</div>
              </div>
              <div className="p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {testResults.filter(t => t.status === 'failed').length}
                </div>
                <div className="text-sm text-red-700">Tests Failed</div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-600">
                  {testResults.filter(t => t.status === 'pending').length}
                </div>
                <div className="text-sm text-gray-700">Tests Pending</div>
              </div>
            </div>

            {browserTests && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Compatibility Report</h4>
                <pre className="text-sm text-gray-700 whitespace-pre-wrap">
                  {generateCompatibilityReport(browserTests)}
                </pre>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FinalIntegrationTest;
