import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from '../no-hardcoded-brand-strings.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

describe('no-hardcoded-brand-strings', () => {
  ruleTester.run('no-hardcoded-brand-strings', rule, {
      valid: [
        // BRAND.appName usage does not trigger the rule
        {
          code: 'const name = BRAND.appName;',
        },
        // Non-brand strings are fine
        {
          code: 'const x = "hello world";',
        },
        // constants/brand.ts is exempt
        {
          code: 'const name = "Outboxed";',
          filename: 'src/constants/brand.ts',
        },
        // Test files are exempt (.test.ts)
        {
          code: 'const name = "Outboxed";',
          filename: 'src/components/__tests__/AppHeader.test.tsx',
        },
        // Test files are exempt (__tests__ directory)
        {
          code: 'const logo = "/logo.svg";',
          filename: 'src/__tests__/brand.test.ts',
        },
        // Config files are exempt
        {
          code: 'const name = "Outboxed";',
          filename: 'vite.config.ts',
        },
      ],
      invalid: [
        // "Outboxed" in a string literal triggers the rule
        {
          code: 'const name = "Outboxed";',
          errors: [{ messageId: 'hardcodedBrandName' }],
        },
        // "Outboxed" embedded in a longer string triggers the rule
        {
          code: 'const title = "Welcome to Outboxed Dashboard";',
          errors: [{ messageId: 'hardcodedBrandName' }],
        },
        // "/logo.svg" in a string literal triggers the rule
        {
          code: 'const logo = "/logo.svg";',
          errors: [{ messageId: 'hardcodedAssetPath' }],
        },
        // "/logo-dark.svg" triggers the rule
        {
          code: 'const logo = "/logo-dark.svg";',
          errors: [{ messageId: 'hardcodedAssetPath' }],
        },
        // "/logo-full.svg" triggers the rule
        {
          code: 'const logo = "/logo-full.svg";',
          errors: [{ messageId: 'hardcodedAssetPath' }],
        },
        // "Outboxed" in a template literal triggers the rule
        {
          code: 'const msg = `Welcome to Outboxed`;',
          errors: [{ messageId: 'hardcodedBrandName' }],
        },
      ],
    });
});
