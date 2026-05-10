import { prisma } from "../db.js";

/**
 * Deployment-wide non-secret settings (e.g. branding). Stored plaintext
 * in the `AppSetting` table. Anything sensitive belongs in
 * `Secret` (see `secrets/service.ts`) instead.
 *
 * Reads are cached per-process; mutations invalidate the cache so
 * the next read sees the new value.
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
} as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];

const cache = new Map<string, string | null>();

export const DEFAULT_PRODUCT_NAME = "open-agents";

export type PublicBrandingSettings = {
  productName: string;
  faviconUrl: string | null;
  sidebarLogoUrl: string | null;
};

export async function getAppSetting(key: AppSettingKey): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = row?.value ?? null;
  cache.set(key, value);
  return value;
}

export async function setAppSetting(key: AppSettingKey, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  cache.set(key, value);
}

export async function deleteAppSetting(key: AppSettingKey): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
  cache.set(key, null);
}

export function invalidateAppSetting(key?: AppSettingKey): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Snapshot of every known app setting, used by the API's GET endpoint
 * to render the General settings page. Values are plaintext — never
 * put credentials here.
 */
export async function listAppSettings(): Promise<
  { key: AppSettingKey; value: string | null }[]
> {
  const out: { key: AppSettingKey; value: string | null }[] = [];
  for (const key of Object.values(APP_SETTING_KEYS)) {
    out.push({ key, value: await getAppSetting(key) });
  }
  return out;
}

export async function getPublicBrandingSettings(): Promise<PublicBrandingSettings> {
  return {
    productName:
      (await getAppSetting(APP_SETTING_KEYS.PRODUCT_NAME)) ?? DEFAULT_PRODUCT_NAME,
    faviconUrl: await getAppSetting(APP_SETTING_KEYS.FAVICON_URL),
    sidebarLogoUrl: await getAppSetting(APP_SETTING_KEYS.SIDEBAR_LOGO_URL),
  };
}
