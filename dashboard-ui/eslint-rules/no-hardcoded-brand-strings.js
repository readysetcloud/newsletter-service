/**
 * @fileoverview ESLint rule to prevent hardcoded brand-specific strings.
 * Detects branded string literals ("Outboxed" and known variants),
 * brand asset path literals, and suggests using BRAND.* imports instead.
 *
 * Validates: Requirements 11.2, 11.3
 */

/** @type {string[]} Brand asset paths that should come from BRAND.assets */
const BRAND_ASSET_PATHS = ['/logo.svg', '/logo-dark.svg', '/logo-full.svg'];

/** @type {Record<string, string>} Maps asset paths to their BRAND.assets property */
const ASSET_PATH_TO_BRAND = {
  '/logo.svg': 'BRAND.assets.logo',
  '/logo-dark.svg': 'BRAND.assets.logoDark',
  '/logo-full.svg': 'BRAND.assets.logoFull',
};

/** @type {string} The branded app name to detect */
const BRANDED_NAME = 'Outboxed';

/**
 * Checks if a file path should be exempt from this rule.
 * Exempt: constants/brand.ts, test files, config files.
 * @param {string} filename
 * @returns {boolean}
 */
function isExemptFile(filename) {
  if (!filename) return false;

  const normalized = filename.replace(/\\/g, '/');

  // Exempt constants/brand.ts (the canonical source)
  if (normalized.includes('constants/brand.ts')) return true;

  // Exempt test files
  if (/\.test\.[^/]+$/.test(normalized)) return true;
  if (normalized.includes('__tests__/')) return true;

  // Exempt config files
  if (/\.config\.[^/]+$/.test(normalized)) return true;

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow hardcoded brand-specific strings; use BRAND.* imports from constants/brand.ts instead',
    },
    messages: {
      hardcodedBrandName:
        'Hardcoded brand string "{{value}}" detected. Import and use BRAND.appName from constants/brand.ts instead.',
      hardcodedAssetPath:
        'Hardcoded brand asset path "{{value}}" detected. Import and use {{suggestion}} from constants/brand.ts instead.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename
      ? context.getFilename()
      : context.filename;

    if (isExemptFile(filename)) {
      return {};
    }

    /**
     * Checks a string value for brand violations and reports if found.
     * @param {import('eslint').Rule.Node} node
     * @param {string} value
     */
    function checkStringValue(node, value) {
      if (typeof value !== 'string') return;

      // Check for branded name (case-sensitive)
      if (value.includes(BRANDED_NAME)) {
        context.report({
          node,
          messageId: 'hardcodedBrandName',
          data: { value },
        });
        return;
      }

      // Check for exact asset path matches
      if (BRAND_ASSET_PATHS.includes(value)) {
        context.report({
          node,
          messageId: 'hardcodedAssetPath',
          data: { value, suggestion: ASSET_PATH_TO_BRAND[value] },
        });
      }
    }

    return {
      // String literals
      Literal(node) {
        if (typeof node.value === 'string') {
          checkStringValue(node, node.value);
        }
      },

      // Template literals — check each quasi (static part)
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          const raw = quasi.value.raw;
          if (typeof raw === 'string' && raw.includes(BRANDED_NAME)) {
            context.report({
              node,
              messageId: 'hardcodedBrandName',
              data: { value: raw },
            });
            return;
          }
        }
      },

      // JSX text
      JSXText(node) {
        if (typeof node.value === 'string' && node.value.includes(BRANDED_NAME)) {
          context.report({
            node,
            messageId: 'hardcodedBrandName',
            data: { value: node.value.trim() },
          });
        }
      },
    };
  },
};

export default rule;
