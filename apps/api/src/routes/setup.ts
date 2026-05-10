import { Hono } from "hono";
import { z } from "zod";
import { createUserWithPassword } from "../auth/index.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { resetAgentBackend } from "../agent-backend/instance.js";
import { APP_SETTING_KEYS, setAppSetting } from "../services/appSettings.js";
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
  anthropicApiKey: z.string().min(1),
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
 * One-shot deployment bootstrap. Creates the first admin user, persists
 * Anthropic and Mailgun service credentials encrypted in Postgres, and
 * resets the in-process Anthropic backend so subsequent calls pick up the
 * new key.
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

  const adminUser = await createUserWithPassword({
    email: body.admin.email,
    name: body.admin.name,
    password: body.admin.password,
    role: "admin",
  });

  await setServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY, body.anthropicApiKey);
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
  resetAgentBackend();

  log.info("setup: completed", {
    adminId: adminUser.id,
    email: body.admin.email,
  });
  return c.json({ ok: true, adminId: adminUser.id });
});
