import { File } from "node:buffer";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, requireAdmin, requireUser } from "../../auth/middleware.js";
import {
  APP_SETTING_KEYS,
  type AppSettingKey,
  deleteAppSetting,
  getAppSetting,
  invalidateAppSetting,
  listAppSettings,
  setAppSetting,
} from "../../services/appSettings.js";
import {
  deleteBrandingAsset,
  MAX_BRANDING_BYTES,
  saveBrandingImage,
} from "../../services/uploads.js";
import type { AppVariables } from "../../server/types.js";

export const settingsRoutes = new Hono<{ Variables: AppVariables }>();

const ALLOWED: AppSettingKey[] = Object.values(APP_SETTING_KEYS);

/**
 * Read-only listing of every known app setting. Returns plaintext
 * values — only non-sensitive deployment-wide settings live in
 * `AppSetting` (sensitive values live in the encrypted `Secret` table).
 *
 * Anyone signed in can read these because they're public-ish (the email
 * footer logo URL ends up in every outbound email anyway). Mutations
 * are admin-only.
 */
settingsRoutes.get("/", async (c) => {
  requireUser(c);
  return c.json({ settings: await listAppSettings() });
});

const PutBody = z.object({
  value: z.string(),
});

settingsRoutes.put("/:key", async (c) => {
  requireAdmin(c);
  const key = c.req.param("key") as AppSettingKey;
  if (!ALLOWED.includes(key)) {
    return c.json({ error: "unknown setting key" }, 400);
  }
  const body = PutBody.parse(await c.req.json());
  const trimmed = body.value.trim();
  if (trimmed.length === 0) {
    await deleteAppSetting(key);
  } else {
    await setAppSetting(key, trimmed);
  }
  invalidateAppSetting(key);
  return c.json({ ok: true });
});

settingsRoutes.delete("/:key", async (c) => {
  requireAdmin(c);
  const key = c.req.param("key") as AppSettingKey;
  if (!ALLOWED.includes(key)) {
    return c.json({ error: "unknown setting key" }, 400);
  }
  if (key === APP_SETTING_KEYS.EMAIL_FOOTER_LOGO_URL) {
    const existing = await getAppSetting(key);
    if (existing) {
      await deleteBrandingAsset({ kind: "footer", urlOrFilename: existing });
    }
  }
  await deleteAppSetting(key);
  invalidateAppSetting(key);
  return c.json({ ok: true });
});

/**
 * Upload (or replace) the deployment-wide footer logo. Stored on disk
 * under `apps/api/data/uploads/footer/` and served from
 * `/static/uploads/...`. The previous file (if any) is deleted so the
 * upload directory doesn't accumulate orphans.
 */
settingsRoutes.post("/email-footer-logo", async (c) => {
  requireAdmin(c);
  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody({ all: false });
  } catch {
    throw new HttpError(400, "invalid multipart body");
  }
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "missing 'file' field");
  if (file.size === 0) throw new HttpError(400, "empty file");
  if (file.size > MAX_BRANDING_BYTES) {
    throw new HttpError(413, `file too large (>${MAX_BRANDING_BYTES} bytes)`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let saved;
  try {
    saved = await saveBrandingImage({
      kind: "footer",
      prefix: "footer",
      bytes,
      contentType: file.type || "application/octet-stream",
      originalName: file.name || "footer",
    });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }

  const previous = await getAppSetting(APP_SETTING_KEYS.EMAIL_FOOTER_LOGO_URL);
  if (previous) {
    await deleteBrandingAsset({ kind: "footer", urlOrFilename: previous });
  }
  await setAppSetting(APP_SETTING_KEYS.EMAIL_FOOTER_LOGO_URL, saved.url);
  invalidateAppSetting(APP_SETTING_KEYS.EMAIL_FOOTER_LOGO_URL);
  return c.json({ value: saved.url });
});
