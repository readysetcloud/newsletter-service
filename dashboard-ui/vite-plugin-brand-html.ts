import type { Plugin } from 'vite';
import { BRAND } from './src/constants/brand';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Vite plugin that reads BRAND.meta from constants/brand.ts
 * and replaces %BRAND_*% placeholders in index.html at build time.
 *
 * Fails the build if any required value is missing, empty, or malformed.
 */
export function brandHtmlPlugin(): Plugin {
  return {
    name: 'brand-html',
    transformIndexHtml(html) {
      const replacements: Record<string, string> = {
        '%BRAND_APP_TITLE%': BRAND.meta.defaultPageTitle,
        '%BRAND_META_DESCRIPTION%': BRAND.meta.description,
        '%BRAND_OG_TITLE%': BRAND.meta.ogTitle,
        '%BRAND_OG_DESCRIPTION%': BRAND.meta.ogDescription,
        '%BRAND_TWITTER_TITLE%': BRAND.meta.twitterTitle,
        '%BRAND_TWITTER_DESCRIPTION%': BRAND.meta.twitterDescription,
        '%BRAND_THEME_COLOR%': BRAND.meta.themeColor,
      };

      // Validate: fail build if any value is empty or undefined
      for (const [placeholder, value] of Object.entries(replacements)) {
        if (!value) {
          throw new Error(
            `[brand-html] Missing required brand meta value for ${placeholder}. ` +
            `Check BRAND.meta in src/constants/brand.ts.`
          );
        }
      }

      // Validate themeColor format
      if (!HEX_COLOR_PATTERN.test(BRAND.meta.themeColor)) {
        throw new Error(
          `[brand-html] Invalid themeColor "${BRAND.meta.themeColor}". ` +
          `Must be a 6-digit hex color (e.g., "#3B82F6").`
        );
      }

      let result = html;
      for (const [placeholder, value] of Object.entries(replacements)) {
        result = result.replaceAll(placeholder, value);
      }
      return result;
    },
  };
}
