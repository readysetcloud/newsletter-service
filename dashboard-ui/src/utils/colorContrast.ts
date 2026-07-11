/**
 * Color contrast utilities for WCAG AA compliance
 *
 * WCAG AA Requirements:
 * - Normal text (< 18pt or < 14pt bold): 4.5:1 contrast ratio
 * - Large text (>= 18pt or >= 14pt bold): 3:1 contrast ratio
 * - UI components and graphical objects: 3:1 contrast ratio
 */

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Calculate relative luminance of a color
 * https://www.w3.org/TR/WCAG20-TECHS/G17.html
 */
function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors
 * https://www.w3.org/TR/WCAG20-TECHS/G17.html
 */
export function calculateContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) {
    throw new Error('Invalid color format. Use hex format (#RRGGBB)');
  }

  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if contrast ratio meets WCAG AA standards
 */
export function meetsWCAGAA(
  contrastRatio: number,
  textSize: 'normal' | 'large' = 'normal'
): boolean {
  const requiredRatio = textSize === 'large' ? 3 : 4.5;
  return contrastRatio >= requiredRatio;
}

/**
 * Check if contrast ratio meets WCAG AAA standards
 */
export function meetsWCAGAAA(
  contrastRatio: number,
  textSize: 'normal' | 'large' = 'normal'
): boolean {
  const requiredRatio = textSize === 'large' ? 4.5 : 7;
  return contrastRatio >= requiredRatio;
}

/**
 * Get contrast level description
 */
export function getContrastLevel(
  contrastRatio: number,
  textSize: 'normal' | 'large' = 'normal'
): 'AAA' | 'AA' | 'Fail' {
  if (meetsWCAGAAA(contrastRatio, textSize)) return 'AAA';
  if (meetsWCAGAA(contrastRatio, textSize)) return 'AA';
  return 'Fail';
}

/**
 * Common color combinations used in the application
 * These should all meet WCAG AA standards
 */
export const COLOR_COMBINATIONS = {
  // Primary text on backgrounds
  'text-foreground-on-background': {
    foreground: '#0f172a', // slate-900 (dark mode: #f1f5f9 slate-100)
    background: '#ffffff', // white (dark mode: #0f172a slate-900)
    description: 'Primary text on main background',
  },
  'text-muted-on-background': {
    foreground: '#64748b', // slate-500
    background: '#ffffff', // white
    description: 'Muted text on main background',
  },

  // Success colors
  'success-text-on-light-bg': {
    foreground: '#0f5348', // success-800
    background: '#ecfdf8', // success-50
    description: 'Success text on light green background',
  },
  'success-text-on-white': {
    foreground: '#0f8f7f', // success-600
    background: '#ffffff', // white
    description: 'Success text on white background',
  },

  // Error colors
  'error-text-on-light-bg': {
    foreground: '#6a0e11', // error-800
    background: '#fdebeb', // error-50
    description: 'Error text on light red background',
  },
  'error-text-on-white': {
    foreground: '#9f1216', // error-600
    background: '#ffffff', // white
    description: 'Error text on white background',
  },

  // Warning colors
  'warning-text-on-light-bg': {
    foreground: '#9a3412', // warning-800
    background: '#fff7ed', // warning-50
    description: 'Warning text on light amber background',
  },
  'warning-text-on-white': {
    foreground: '#ea580c', // warning-600
    background: '#ffffff', // white
    description: 'Warning text on white background',
  },

  // Primary colors
  'primary-text-on-light-bg': {
    foreground: '#0a5490', // primary-800
    background: '#ebf6ff', // primary-50
    description: 'Primary text on light blue background',
  },
  'primary-text-on-white': {
    foreground: '#0b82e6', // primary-600
    background: '#ffffff', // white
    description: 'Primary text on white background',
  },

  // Interactive elements
  'link-on-white': {
    foreground: '#0b82e6', // primary-600
    background: '#ffffff', // white
    description: 'Link text on white background',
  },
  'button-text-on-primary': {
    foreground: '#ffffff', // white
    background: '#0b82e6', // primary-600
    description: 'Button text on primary button',
  },
} as const;

/**
 * Verify all color combinations meet WCAG AA standards
 */
export function verifyColorContrast(): {
  passed: boolean;
  results: Array<{
    name: string;
    description: string;
    contrastRatio: number;
    level: string;
    passes: boolean;
  }>;
} {
  const results = Object.entries(COLOR_COMBINATIONS).map(([name, combo]) => {
    const contrastRatio = calculateContrastRatio(combo.foreground, combo.background);
    const level = getContrastLevel(contrastRatio, 'normal');
    const passes = meetsWCAGAA(contrastRatio, 'normal');

    return {
      name,
      description: combo.description,
      contrastRatio: Math.round(contrastRatio * 100) / 100,
      level,
      passes,
    };
  });

  const passed = results.every((r) => r.passes);

  return { passed, results };
}
