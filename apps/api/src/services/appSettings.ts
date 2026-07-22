import { prisma } from "../db.js";
import { APP_SETTING_KEYS, GENERIC_APP_SETTING_KEYS } from "./appSettingPolicy.js";
import type { AppSettingKey } from "./appSettingPolicy.js";

/**
 * Deployment-wide non-secret settings (e.g. branding). Stored plaintext
 * in the `AppSetting` table. Anything sensitive belongs in
 * `Secret` (see `secrets/service.ts`) instead.
 *
 * Reads are cached per-process; mutations invalidate the cache so
 * the next read sees the new value.
 *
 * The key set and which keys the generic settings route may touch live in
 * `appSettingPolicy.ts`.
 */

export { APP_SETTING_KEYS };
export type { AppSettingKey };

const cache = new Map<string, string | null>();

export const DEFAULT_PRODUCT_NAME = "open-agents";
export const DEFAULT_EMAIL_DISCLAIMER =
  "Agents can make mistakes. Do not send personal, confidential, or sensitive information in this email thread.";

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
 * Snapshot of the app settings the General settings page renders as generic
 * editable text. Values are plaintext — never put credentials here.
 *
 * Reserved keys are omitted: the page turns every entry into a free-form
 * field, and `sandbox_provider` has its own health-checked editor.
 */
export async function listAppSettings(): Promise<
  { key: AppSettingKey; value: string | null }[]
> {
  const out: { key: AppSettingKey; value: string | null }[] = [];
  for (const key of GENERIC_APP_SETTING_KEYS) {
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
