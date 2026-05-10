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
  /** Absolute or `/static/...` URL of the logo image rendered in the
   *  outbound email footer. When empty, the footer omits the image. */
  EMAIL_FOOTER_LOGO_URL: "email_footer_logo_url",
} as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];

const cache = new Map<string, string | null>();

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
