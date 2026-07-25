/**
 * Tenant-wide defaults the platform falls back to when a request doesn't
 * specify a value. Mirrors the `/settings` contract in `openapi.yaml`.
 */
export interface TenantSettings {
  /** IANA timezone name, e.g. `America/Chicago`. */
  timezone: string;
  /** 24-hour `HH:MM` time of day, expressed in {@link timezone}. */
  defaultSendTime: string;
  /**
   * Subject format used when the request that staged an issue didn't supply
   * one. Supports `{{title}}`, `{{number}}` and `{{date}}`. Absent means the
   * issue title is used — there is no system default.
   */
  subjectTemplate?: string;
  /**
   * Absolute URL where issues live on the tenant's site, containing
   * `{{number}}`. Absent means the "view online" link is omitted.
   */
  issueUrlPattern?: string;
}

export interface SettingsResponse {
  /** Effective settings: stored values where set, system defaults elsewhere. */
  settings: TenantSettings;
  /** The system defaults, so the UI can mark inherited values as such. */
  defaults: TenantSettings;
  /** When settings were last saved; absent if they never have been. */
  updatedAt?: string;
}

/**
 * A partial update. An omitted key is left unchanged; a key sent as `null`
 * resets that setting to the system default.
 */
export type UpdateSettingsRequest = Partial<{
  [K in keyof TenantSettings]: TenantSettings[K] | null;
}>;
