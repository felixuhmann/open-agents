import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, requireUser } from "../../auth/middleware.js";
import {
  APP_SETTING_KEYS,
  type AppSettingKey,
  deleteAppSetting,
  invalidateAppSetting,
  listAppSettings,
  setAppSetting,
} from "../../services/appSettings.js";
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
  await deleteAppSetting(key);
  invalidateAppSetting(key);
  return c.json({ ok: true });
});
