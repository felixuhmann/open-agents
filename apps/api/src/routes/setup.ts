import { SandboxProviderIdSchema } from "@open-agents/types";
import { Hono } from "hono";
import { z } from "zod";
import { createUserWithPassword } from "../auth/index.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { resetAgentBackend } from "../agent-backend/instance.js";
import {
  APP_SETTING_KEYS,
  invalidateAppSetting,
  setAppSetting,
} from "../services/appSettings.js";
import { sandboxProviderSettings } from "../services/sandboxProviderSettingsInstance.js";
import {
  invalidateServiceSecret,
  isServiceSetupComplete,
  SERVICE_KEYS,
  setServiceSecret,
} from "../secrets/service.js";

import type { AppVariables } from "../server/types.js";

export const SETUP_PREFIX = "/api/setup";

export const setupRoutes = new Hono<{ Variables: AppVariables }>();

const SetupBody = z.object({
  /** Sandbox provider this deployment runs on. Defaults to Daytona. */
  sandboxProvider: SandboxProviderIdSchema.default("daytona"),
  /** Required only when Daytona is the selected provider. */
  daytonaApiKey: z.string().min(1).optional(),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  mailgunApiKey: z.string().optional(),
  mailgunDomain: z.string().optional(),
  mailgunSigningKey: z.string().optional(),
  inboundFrom: z.string().optional(),
  admin: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(120),
    password: z.string().min(8).max(200),
  }),
});

/**
 * Setup status ping: the SPA calls this on every page load. While
 * `complete = false`, every protected page redirects to /setup.
 */
setupRoutes.get("/status", async (c) => {
  const userCount = await prisma.user.count();
  const complete = (await isServiceSetupComplete()) && userCount > 0;
  return c.json({ complete, userCount });
});

/**
 * One-shot deployment bootstrap. Creates the first admin user, records the
 * chosen sandbox provider, persists provider/model/Mailgun service
 * credentials encrypted in Postgres, and resets the in-process backend so
 * subsequent calls pick up the new configuration.
 *
 * Refuses to run a second time once any user exists — rotate values via
 * the admin Settings UI (`/api/secrets`) instead.
 */
setupRoutes.post("/", async (c) => {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return c.json({ error: "setup already complete" }, 409);
  }

  const body = SetupBody.parse(await c.req.json());

  if (body.sandboxProvider === "daytona" && !body.daytonaApiKey) {
    return c.json(
      { error: "daytonaApiKey is required when using the Daytona provider" },
      400,
    );
  }

  const adminUser = await createUserWithPassword({
    email: body.admin.email,
    name: body.admin.name,
    password: body.admin.password,
    role: "admin",
  });

  if (body.daytonaApiKey) {
    await setServiceSecret(SERVICE_KEYS.DAYTONA_API_KEY, body.daytonaApiKey);
  }
  await setAppSetting(APP_SETTING_KEYS.SANDBOX_PROVIDER, body.sandboxProvider);
  if (body.anthropicApiKey) {
    await setServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY, body.anthropicApiKey);
  }
  if (body.openaiApiKey) {
    await setServiceSecret(SERVICE_KEYS.OPENAI_API_KEY, body.openaiApiKey);
  }
  if (body.openrouterApiKey) {
    await setServiceSecret(SERVICE_KEYS.OPENROUTER_API_KEY, body.openrouterApiKey);
  }
  if (body.mailgunApiKey) {
    await setServiceSecret(SERVICE_KEYS.MAILGUN_API_KEY, body.mailgunApiKey);
  }
  if (body.mailgunDomain) {
    await setServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN, body.mailgunDomain);
  }
  if (body.mailgunSigningKey) {
    await setServiceSecret(SERVICE_KEYS.MAILGUN_SIGNING_KEY, body.mailgunSigningKey);
  }
  if (body.inboundFrom) {
    await setAppSetting(APP_SETTING_KEYS.INBOUND_FROM, body.inboundFrom);
  }
  invalidateServiceSecret();
  invalidateAppSetting();
  resetAgentBackend();

  // A broker selection is only accepted once the broker actually answers.
  if (body.sandboxProvider !== "daytona") {
    try {
      await sandboxProviderSettings.select(body.sandboxProvider);
    } catch (err) {
      await setAppSetting(APP_SETTING_KEYS.SANDBOX_PROVIDER, "daytona");
      invalidateAppSetting();
      resetAgentBackend();
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }

  log.info("setup: completed", {
    adminId: adminUser.id,
    email: body.admin.email,
  });
  return c.json({ ok: true, adminId: adminUser.id });
});
