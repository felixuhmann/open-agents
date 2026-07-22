/**
 * Which deployment settings the generic `/api/settings` surface may read and
 * write.
 *
 * Most `AppSetting` rows are free-form branding text, so the generic route
 * treats them as opaque strings. A few are *reserved*: they have their own
 * endpoint because writing them safely needs domain logic the generic route
 * has no way to run. `sandbox_provider` is the first — selecting a provider
 * has to health-check it first, leave the previous selection untouched when
 * that fails, and reset cached provider instances afterwards
 * (`sandboxProviderSettings.select()`).
 *
 * Kept free of database imports so the policy is testable on its own.
 */

export const APP_SETTING_KEYS = {
  /** Human-readable product name shown in the web app chrome and page title. */
  PRODUCT_NAME: "product_name",
  /** Absolute or `/static/...` URL of the browser favicon. */
  FAVICON_URL: "favicon_url",
  /** Absolute or `/static/...` URL of the image shown in the sidebar brand slot. */
  SIDEBAR_LOGO_URL: "sidebar_logo_url",
  /** Absolute or `/static/...` URL of the logo image rendered in the
   *  outbound email footer. When empty, the footer omits the image. */
  EMAIL_FOOTER_LOGO_URL: "email_footer_logo_url",
  /** Plain-text disclaimer paragraph rendered in the outbound email footer. */
  EMAIL_DISCLAIMER: "email_disclaimer",
  /** Default outbound `From:` header for legacy email threads. */
  INBOUND_FROM: "inbound_from",
  /**
   * Sandbox provider new sandboxes are created on, deployment-wide.
   * Absent means `daytona` (see `sandboxProviderSettings.ts`).
   *
   * Reserved: mutate through `PUT /api/sandbox-provider` only.
   */
  SANDBOX_PROVIDER: "sandbox_provider",
} as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];

/** Endpoint that owns each reserved key, used in the rejection message. */
const RESERVED_APP_SETTING_OWNERS: Partial<Record<AppSettingKey, string>> = {
  [APP_SETTING_KEYS.SANDBOX_PROVIDER]: "/api/sandbox-provider",
};

export function isReservedAppSettingKey(key: AppSettingKey): boolean {
  return key in RESERVED_APP_SETTING_OWNERS;
}

/** Keys the generic settings route may list and mutate. */
export const GENERIC_APP_SETTING_KEYS: AppSettingKey[] = (
  Object.values(APP_SETTING_KEYS) as AppSettingKey[]
).filter((key) => !isReservedAppSettingKey(key));

export type AppSettingMutationRejection = {
  status: 400 | 409;
  error: string;
};

/**
 * Reason the generic settings route must refuse this key, or `null` when the
 * write is allowed. Unknown keys are a client bug (400); reserved keys are a
 * routing mistake with an actionable alternative (409).
 */
export function rejectGenericAppSettingMutation(
  key: string,
): AppSettingMutationRejection | null {
  const owner = RESERVED_APP_SETTING_OWNERS[key as AppSettingKey];
  if (owner) {
    return {
      status: 409,
      error: `"${key}" is managed by ${owner} and cannot be set through /api/settings.`,
    };
  }
  if (!GENERIC_APP_SETTING_KEYS.includes(key as AppSettingKey)) {
    return { status: 400, error: "unknown setting key" };
  }
  return null;
}
