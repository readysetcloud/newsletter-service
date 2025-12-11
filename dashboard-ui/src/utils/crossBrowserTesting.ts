/**
 * Cross-browser testing utilities for the visual builder
 */

export interface CrossBrowserTestResult {
  name: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
  details?: any;
}

export interface CrossBrowserTestSuite {
  [key: string]: CrossBrowserTestResult;
}

/**
 * Run comprehensive cross-browser compatibility tests
 */
export const runCrossBrowserTests = async (): Promise<CrossBrowserTestSuite> => {
  const results: CrossBrowserTestSuite = {};

  // Test 1: Drag and Drop API
  results.dragAndDrop = await testDragAndDrop();

  // Test 2: CSS Animations
  results.cssAnimations = await testCSSAnimations();

  // Test 3: Flexbox Layout
  results.flexboxLayout = await testFlexboxLayout();

  // Test 4: CSS Grid Layout
  results.cssGrid = await testCSSGrid();

  // Test 5: Local Storage
  results.localStorage = await testLocalStorage();

  // Test 6: Session Storage
  results.sessionStorage = await testSessionStorage();

  // Test 7: Touch Events
  results.touchEvents = await testTouchEvents();

  // Test 8: Intersection Observer
  results.intersectionObserver = await testIntersectionObserver();

  // Test 9: Resize Observer
  results.resizeObserver = await testResizeObserver();

  // Test 10: Web Workers
  results.webWorkers = await testWebWorkers();

  // Test 11: IndexedDB
  results.indexedDB = await testIndexedDB();

  // Test 12: WebGL
  results.webGL = await testWebGL();

  // Test 13: Performance API
  results.performanceAPI = await testPerformanceAPI();

  // Test 14: Custom Elements
  results.customElements = await testCustomElements();

  // Test 15: ES6 Features
  results.es6Features = await testES6Features();

  return results;
};

/**
 * Test Drag and Drop API support
 */
const testDragAndDrop = async (): Promise<CrossBrowserTestResult> => {
  try {
    const testDiv = document.createElement('div');
    testDiv.draggable = true;

    const hasDraggable = 'draggable' in testDiv;
    const hasDragEvents = 'ondragstart' in testDiv && 'ondrop' in testDiv;
    const hasDataTransfer = 'DataTransfer' in window;

    if (hasDraggable && hasDragEvents && hasDataTransfer) {
      // Test actual drag event creation
      const dragEvent = new DragEvent('dragstart', { bubbles: true });
      const canDispatch = testDiv.dispatchEvent(dragEvent);

      return {
        name: 'Drag and Drop API',
        passed: canDispatch,
        message: canDispatch ? 'Full drag and drop support' : 'Limited drag and drop support',
        severity: canDispatch ? 'info' : 'warning',
        details: { hasDraggable, hasDragEvents, hasDataTransfer, canDispatch }
      };
    } else {
      return {
        name: 'Drag and Drop API',
        passed: false,
        message: 'Drag and drop not supported',
        severity: 'error',
        details: { hasDraggable, hasDragEvents, hasDataTransfer }
      };
    }
  } catch (error) {
    return {
      name: 'Drag and Drop API',
      passed: false,
      message: 'Drag and drop test failed',
      severity: 'error',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test CSS Animations support
 */
const testCSSAnimations = async (): Promise<CrossBrowserTestResult> => {
  try {
    const supportsAnimations = CSS.supports('animation', 'none');
    const supportsWebkitAnimations = CSS.supports('-webkit-animation', 'none');
    const supportsTransitions = CSS.supports('transition', 'none');

    const hasAnimationEvent = 'AnimationEvent' in window;
    const hasTransitionEvent = 'TransitionEvent' in window;

    const fullSupport = supportsAnimations && supportsTransitions && hasAnimationEvent;
    const partialSupport = (supportsAnimations || supportsWebkitAnimations) && supportsTransitions;

    return {
      name: 'CSS Animations',
      passed: fullSupport || partialSupport,
      message: fullSupport
        ? 'Full animation support'
        : partialSupport
        ? 'Partial animation support (may need prefixes)'
        : 'No animation support',
      severity: fullSupport ? 'info' : partialSupport ? 'warning' : 'error',
      details: {
        supportsAnimations,
        supportsWebkitAnimations,
        supportsTransitions,
        hasAnimationEvent,
        hasTransitionEvent
      }
    };
  } catch (error) {
    return {
      name: 'CSS Animations',
      passed: false,
      message: 'Animation test failed',
      severity: 'error',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Flexbox Layout support
 */
const testFlexboxLayout = async (): Promise<CrossBrowserTestResult> => {
  try {
    const supportsFlex = CSS.supports('display', 'flex');
    const supportsWebkitFlex = CSS.supports('display', '-webkit-flex');
    const supportsMsFlex = CSS.supports('display', '-ms-flexbox');

    const testElement = document.createElement('div');
    testElement.style.display = 'flex';
    const computedDisplay = window.getComputedStyle(testElement).display;

    const fullSupport = supportsFlex && (computedDisplay === 'flex' || computedDisplay === '-webkit-flex');
    const partialSupport = supportsWebkitFlex || supportsMsFlex;

    return {
      name: 'Flexbox Layout',
      passed: fullSupport || partialSupport,
      message: fullSupport
        ? 'Full flexbox support'
        : partialSupport
        ? 'Partial flexbox support (may need prefixes)'
        : 'No flexbox support',
      severity: fullSupport ? 'info' : partialSupport ? 'warning' : 'error',
      details: {
        supportsFlex,
        supportsWebkitFlex,
        supportsMsFlex,
        computedDisplay
      }
    };
  } catch (error) {
    return {
      name: 'Flexbox Layout',
      passed: false,
      message: 'Flexbox test failed',
      severity: 'error',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test CSS Grid Layout support
 */
const testCSSGrid = async (): Promise<CrossBrowserTestResult> => {
  try {
    const supportsGrid = CSS.supports('display', 'grid');
    const supportsMsGrid = CSS.supports('display', '-ms-grid');

    const testElement = document.createElement('div');
    testElement.style.display = 'grid';
    const computedDisplay = window.getComputedStyle(testElement).display;

    const fullSupport = supportsGrid && computedDisplay === 'grid';
    const partialSupport = supportsMsGrid;

    return {
      name: 'CSS Grid Layout',
      passed: fullSupport || partialSupport,
      message: fullSupport
        ? 'Full grid support'
        : partialSupport
        ? 'Partial grid support (IE11 syntax)'
        : 'No grid support',
      severity: fullSupport ? 'info' : partialSupport ? 'warning' : 'warning', // Grid is not critical
      details: {
        supportsGrid,
        supportsMsGrid,
        computedDisplay
      }
    };
  } catch (error) {
    return {
      name: 'CSS Grid Layout',
      passed: false,
      message: 'Grid test failed',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Local Storage support
 */
const testLocalStorage = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasLocalStorage = 'localStorage' in window;

    if (!hasLocalStorage) {
      return {
        name: 'Local Storage',
        passed: false,
        message: 'Local storage not available',
        severity: 'error'
      };
    }

    // Test actual functionality
    const testKey = 'vb-test-' + Date.now();
    const testValue = 'test-value';

    localStorage.setItem(testKey, testValue);
    const retrievedValue = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);

    const works = retrievedValue === testValue;

    return {
      name: 'Local Storage',
      passed: works,
      message: works ? 'Local storage working' : 'Local storage blocked or limited',
      severity: works ? 'info' : 'error',
      details: { hasLocalStorage, works }
    };
  } catch (error) {
    return {
      name: 'Local Storage',
      passed: false,
      message: 'Local storage test failed (may be disabled in private mode)',
      severity: 'error',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Session Storage support
 */
const testSessionStorage = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasSessionStorage = 'sessionStorage' in window;

    if (!hasSessionStorage) {
      return {
        name: 'Session Storage',
        passed: false,
        message: 'Session storage not available',
        severity: 'warning'
      };
    }

    // Test actual functionality
    const testKey = 'vb-test-' + Date.now();
    const testValue = 'test-value';

    sessionStorage.setItem(testKey, testValue);
    const retrievedValue = sessionStorage.getItem(testKey);
    sessionStorage.removeItem(testKey);

    const works = retrievedValue === testValue;

    return {
      name: 'Session Storage',
      passed: works,
      message: works ? 'Session storage working' : 'Session storage blocked or limited',
      severity: works ? 'info' : 'warning',
      details: { hasSessionStorage, works }
    };
  } catch (error) {
    return {
      name: 'Session Storage',
      passed: false,
      message: 'Session storage test failed',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Touch Events support
 */
const testTouchEvents = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasTouchStart = 'ontouchstart' in window;
    const hasMaxTouchPoints = navigator.maxTouchPoints > 0;
    const hasMsMaxTouchPoints = (navigator as any).msMaxTouchPoints > 0;
    const hasTouchEvent = 'TouchEvent' in window;

    const hasTouch = hasTouchStart || hasMaxTouchPoints || hasMsMaxTouchPoints;

    return {
      name: 'Touch Events',
      passed: hasTouch,
      message: hasTouch ? 'Touch events supported' : 'No touch support detected',
      severity: 'info', // Touch is optional
      details: {
        hasTouchStart,
        hasMaxTouchPoints,
        hasMsMaxTouchPoints,
        hasTouchEvent,
        maxTouchPoints: navigator.maxTouchPoints
      }
    };
  } catch (error) {
    return {
      name: 'Touch Events',
      passed: false,
      message: 'Touch test failed',
      severity: 'info',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Intersection Observer support
 */
const testIntersectionObserver = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasIntersectionObserver = 'IntersectionObserver' in window;

    if (!hasIntersectionObserver) {
      return {
        name: 'Intersection Observer',
        passed: false,
        message: 'Intersection Observer not supported (polyfill will be used)',
        severity: 'warning'
      };
    }

    // Test basic functionality
    let works = false;
    const testElement = document.createElement('div');
    document.body.appendChild(testElement);

    const observer = new IntersectionObserver((entries) => {
      works = entries.length > 0;
    });

    observer.observe(testElement);

    // Give it a moment to trigger
    await new Promise(resolve => setTimeout(resolve, 10));

    observer.disconnect();
    document.body.removeChild(testElement);

    return {
      name: 'Intersection Observer',
      passed: works,
      message: works ? 'Intersection Observer working' : 'Intersection Observer available but not functioning',
      severity: works ? 'info' : 'warning',
      details: { hasIntersectionObserver, works }
    };
  } catch (error) {
    return {
      name: 'Intersection Observer',
      passed: false,
      message: 'Intersection Observer test failed',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Resize Observer support
 */
const testResizeObserver = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasResizeObserver = 'ResizeObserver' in window;

    return {
      name: 'Resize Observer',
      passed: hasResizeObserver,
      message: hasResizeObserver ? 'Resize Observer supported' : 'Resize Observer not supported (polyfill will be used)',
      severity: hasResizeObserver ? 'info' : 'warning',
      details: { hasResizeObserver }
    };
  } catch (error) {
    return {
      name: 'Resize Observer',
      passed: false,
      message: 'Resize Observer test failed',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Web Workers support
 */
const testWebWorkers = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasWorker = 'Worker' in window;

    return {
      name: 'Web Workers',
      passed: hasWorker,
      message: hasWorker ? 'Web Workers supported' : 'Web Workers not supported',
      severity: hasWorker ? 'info' : 'warning',
      details: { hasWorker }
    };
  } catch (error) {
    return {
      name: 'Web Workers',
      passed: false,
      message: 'Web Workers test failed',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test IndexedDB support
 */
const testIndexedDB = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasIndexedDB = 'indexedDB' in window;

    return {
      name: 'IndexedDB',
      passed: hasIndexedDB,
      message: hasIndexedDB ? 'IndexedDB supported' : 'IndexedDB not supported',
      severity: hasIndexedDB ? 'info' : 'warning',
      details: { hasIndexedDB }
    };
  } catch (error) {
    return {
      name: 'IndexedDB',
      passed: false,
      message: 'IndexedDB test failed',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test WebGL support
 */
const testWebGL = async (): Promise<CrossBrowserTestResult> => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const hasWebGL = !!gl;

    return {
      name: 'WebGL',
      passed: hasWebGL,
      message: hasWebGL ? 'WebGL supported' : 'WebGL not supported',
      severity: 'info', // WebGL is optional for visual builder
      details: { hasWebGL }
    };
  } catch (error) {
    return {
      name: 'WebGL',
      passed: false,
      message: 'WebGL test failed',
      severity: 'info',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Performance API support
 */
const testPerformanceAPI = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasPerformance = 'performance' in window;
    const hasNow = hasPerformance && 'now' in performance;
    const hasMark = hasPerformance && 'mark' in performance;
    const hasMeasure = hasPerformance && 'measure' in performance;

    const fullSupport = hasPerformance && hasNow && hasMark && hasMeasure;
    const basicSupport = hasPerformance && hasNow;

    return {
      name: 'Performance API',
      passed: basicSupport,
      message: fullSupport
        ? 'Full Performance API support'
        : basicSupport
        ? 'Basic Performance API support'
        : 'Performance API not supported',
      severity: fullSupport ? 'info' : basicSupport ? 'warning' : 'warning',
      details: { hasPerformance, hasNow, hasMark, hasMeasure }
    };
  } catch (error) {
    return {
      name: 'Performance API',
      passed: false,
      message: 'Performance API test failed',
      severity: 'warning',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test Custom Elements support
 */
const testCustomElements = async (): Promise<CrossBrowserTestResult> => {
  try {
    const hasCustomElements = 'customElements' in window;
    const hasDefine = hasCustomElements && 'define' in window.customElements;

    return {
      name: 'Custom Elements',
      passed: hasCustomElements && hasDefine,
      message: (hasCustomElements && hasDefine)
        ? 'Custom Elements supported'
        : 'Custom Elements not supported',
      severity: 'info', // Custom Elements are optional
      details: { hasCustomElements, hasDefine }
    };
  } catch (error) {
    return {
      name: 'Custom Elements',
      passed: false,
      message: 'Custom Elements test failed',
      severity: 'info',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Test ES6 Features support
 */
const testES6Features = async (): Promise<CrossBrowserTestResult> => {
  try {
    let supportedFeatures = 0;
    const totalFeatures = 8;

    // Test arrow functions
    try {
      eval('(() => {})');
      supportedFeatures++;
    } catch {}

    // Test const/let
    try {
      eval('const x = 1; let y = 2;');
      supportedFeatures++;
    } catch {}

    // Test template literals
    try {
      eval('`template ${1} literal`');
      supportedFeatures++;
    } catch {}

    // Test destructuring
    try {
      eval('const {a} = {a: 1};');
      supportedFeatures++;
    } catch {}

    // Test default parameters
    try {
      eval('function test(a = 1) { return a; }');
      supportedFeatures++;
    } catch {}

    // Test spread operator
    try {
      eval('const arr = [1, 2, 3]; const spread = [...arr];');
      supportedFeatures++;
    } catch {}

    // Test classes
    try {
      eval('class Test {}');
      supportedFeatures++;
    } catch {}

    // Test promises
    const hasPromise = 'Promise' in window;
    if (hasPromise) supportedFeatures++;

    const percentage = Math.round((supportedFeatures / totalFeatures) * 100);

    return {
      name: 'ES6 Features',
      passed: supportedFeatures >= 6, // Require at least 75% support
      message: `${supportedFeatures}/${totalFeatures} ES6 features supported (${percentage}%)`,
      severity: supportedFeatures >= 6 ? 'info' : supportedFeatures >= 4 ? 'warning' : 'error',
      details: { supportedFeatures, totalFeatures, percentage }
    };
  } catch (error) {
    return {
      name: 'ES6 Features',
      passed: false,
      message: 'ES6 features test failed',
      severity: 'error',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

/**
 * Calculate overall compatibility score
 */
export const getCompatibilityScore = (testResults: CrossBrowserTestSuite): number => {
  const tests = Object.values(testResults);
  const totalTests = tests.length;

  if (totalTests === 0) return 0;

  let score = 0;

  tests.forEach(test => {
    if (test.passed) {
      // Weight critical features more heavily
      if (['Drag and Drop API', 'Flexbox Layout', 'Local Storage', 'CSS Animations'].includes(test.name)) {
        score += 10; // Critical features worth 10 points
      } else if (test.severity === 'error') {
        score += 5; // Important features worth 5 points
      } else {
        score += 3; // Nice-to-have features worth 3 points
      }
    }
  });

  // Maximum possible score calculation
  const maxScore = tests.reduce((max, test) => {
    if (['Drag and Drop API', 'Flexbox Layout', 'Local Storage', 'CSS Animations'].includes(test.name)) {
      return max + 10;
    } else if (test.severity === 'error') {
      return max + 5;
    } else {
      return max + 3;
    }
  }, 0);

  return Math.round((score / maxScore) * 100);
};

/**
 * Generate a human-readable compatibility report
 */
export const generateCompatibilityReport = (testResults: CrossBrowserTestSuite): string => {
  const tests = Object.values(testResults);
  const passedTests = tests.filter(t => t.passed);
  const failedTests = tests.filter(t => !t.passed);
  const criticalFailures = failedTests.filter(t => t.severity === 'error');

  let report = `Browser Compatibility Report\n`;
  report += `============================\n\n`;

  report += `Overall Score: ${getCompatibilityScore(testResults)}%\n`;
  report += `Tests Passed: ${passedTests.length}/${tests.length}\n\n`;

  if (criticalFailures.length > 0) {
    report += `Critical Issues:\n`;
    criticalFailures.forEach(test => {
      report += `- ${test.name}: ${test.message}\n`;
    });
    report += `\n`;
  }

  const warnings = failedTests.filter(t => t.severity === 'warning');
  if (warnings.length > 0) {
    report += `Warnings:\n`;
    warnings.forEach(test => {
      report += `- ${test.name}: ${test.message}\n`;
    });
    report += `\n`;
  }

  report += `Supported Features:\n`;
  passedTests.forEach(test => {
    report += `✓ ${test.name}\n`;
  });

  return report;
};

export default {
  runCrossBrowserTests,
  getCompatibilityScore,
  generateCompatibilityReport
};
