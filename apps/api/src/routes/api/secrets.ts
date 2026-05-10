import { Hono } from "hono";
import { z } from "zod";
import { resetAgentBackend } from "../../agent-backend/instance.js";
import { requireAdmin } from "../../auth/middleware.js";
import {
  deleteServiceSecret,
  getServiceSecret,
  invalidateServiceSecret,
  SERVICE_KEYS,
  setServiceSecret,
  type ServiceKey,
} from "../../secrets/service.js";
import type { AppVariables } from "../../server/types.js";

export const secretsRoutes = new Hono<{ Variables: AppVariables }>();

const ALLOWED: ServiceKey[] = [
  SERVICE_KEYS.ANTHROPIC_API_KEY,
  SERVICE_KEYS.ANTHROPIC_VAULT_ID,
  SERVICE_KEYS.MAILGUN_API_KEY,
  SERVICE_KEYS.MAILGUN_DOMAIN,
  SERVICE_KEYS.MAILGUN_SIGNING_KEY,
  SERVICE_KEYS.INBOUND_FROM,
];

/**
 * List which service-credential keys are configured (without revealing
 * their plaintext). The Admin Settings page uses this to render the
 * "rotate" form.
 */
secretsRoutes.get("/", async (c) => {
  requireAdmin(c);
  const out: { key: string; configured: boolean }[] = [];
  for (const key of ALLOWED) {
    const v = await getServiceSecret(key);
    out.push({ key, configured: Boolean(v) });
  }
  return c.json({ secrets: out });
});

const PutBody = z.object({
  value: z.string().min(1),
});

secretsRoutes.put("/:key", async (c) => {
  requireAdmin(c);
  const key = c.req.param("key") as ServiceKey;
  if (!ALLOWED.includes(key)) {
    return c.json({ error: "unknown secret key" }, 400);
  }
  const body = PutBody.parse(await c.req.json());
  await setServiceSecret(key, body.value);
  invalidateServiceSecret(key);
  if (key === SERVICE_KEYS.ANTHROPIC_API_KEY || key === SERVICE_KEYS.ANTHROPIC_VAULT_ID) {
    resetAgentBackend();
  }
  return c.json({ ok: true });
});

secretsRoutes.delete("/:key", async (c) => {
  requireAdmin(c);
  const key = c.req.param("key") as ServiceKey;
  if (!ALLOWED.includes(key)) {
    return c.json({ error: "unknown secret key" }, 400);
  }
  await deleteServiceSecret(key);
  if (key === SERVICE_KEYS.ANTHROPIC_API_KEY || key === SERVICE_KEYS.ANTHROPIC_VAULT_ID) {
    resetAgentBackend();
  }
  return c.json({ ok: true });
});
