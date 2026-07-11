/** Type definition for all required branding fields. */
export interface BrandConfig {
  readonly appName: string;
  readonly titleSuffix: string;
  readonly copyrightHolder: string;
  readonly description: string;
  readonly supportUrl: string;
  readonly assets: {
    readonly logo: string;
    readonly logoDark: string;
    readonly logoFull: string;
  };
  readonly meta: {
    readonly defaultPageTitle: string;
    readonly description: string;
    readonly ogTitle: string;
    readonly ogDescription: string;
    readonly twitterTitle: string;
    readonly twitterDescription: string;
    readonly themeColor: string;
  };
  readonly storageKeyPrefix: string;
}

/** All branding constants for the application. */
export const BRAND = {
  appName: 'Outboxed',
  titleSuffix: 'Outboxed',
  copyrightHolder: 'Outboxed',
  description: 'Manage your newsletter brands, API keys, and view analytics with the Outboxed Dashboard.',
  supportUrl: 'mailto:support@outboxed.io',

  assets: {
    logo: '/logo.svg',
    logoDark: '/logo-dark.svg',
    logoFull: '/logo-full.svg',
  },

  meta: {
    defaultPageTitle: 'Outboxed Dashboard',
    description: 'Manage your newsletter brands, API keys, and view analytics with the Outboxed Dashboard.',
    ogTitle: 'Outboxed Dashboard',
    ogDescription: 'Manage your newsletter brands, API keys, and view analytics.',
    twitterTitle: 'Outboxed Dashboard',
    twitterDescription: 'Manage your newsletter brands, API keys, and view analytics.',
    themeColor: '#219eff',
  },

  storageKeyPrefix: 'outboxed',
} as const satisfies BrandConfig;

/** Pre-built storage keys using the configured prefix. */
export const STORAGE_KEYS = {
  theme: `${BRAND.storageKeyPrefix}-theme`,
  issueDetailPreferences: `${BRAND.storageKeyPrefix}-issue-detail-preferences`,
  issueDetailScrollPosition: `${BRAND.storageKeyPrefix}-issue-detail-scroll-position`,
} as const;

/** Format a page title with the brand suffix. */
export function formatPageTitle(routeName?: string): string {
  return routeName ? `${routeName} | ${BRAND.titleSuffix}` : BRAND.titleSuffix;
}
