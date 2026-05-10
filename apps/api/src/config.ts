import { z } from "zod";

/**
 * Bootstrap-only environment. Per the v1 plan, every other secret
 * (Anthropic + Mailgun service credentials, per-tool secrets) is managed
 * through the web UI and persisted encrypted in Postgres. The values here
 * are the minimum the process needs to come up and decrypt the rest.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Public origin of this backend (no trailing slash). Used to build the
   * signed `POST /runs/:runId/attachments` URL we inject into the agent's
   * user message and for outbound email links.
   */
  PUBLIC_BASE_URL: z.string().url(),

  /**
   * Shared bearer token for this backend's MCP endpoints. The Anthropic-side
   * agent config stores the same value via a Vault.
   */
  MCP_AUTH_TOKEN: z.string().min(16),

  /**
   * HMAC secret for signing per-run / per-conversation attachment upload URLs.
   * `openssl rand -hex 32`.
   */
  UPLOAD_SIGNING_SECRET: z.string().min(32),

  /**
   * Symmetric key used by the Secret service to AES-256-GCM encrypt every
   * value in the `Secret` table and the inline bearer fields on
   * `AgentThirdPartyMcp`. Must be 32 bytes hex (64 hex chars). Generate
   * with `openssl rand -hex 32`. Rotation requires a one-shot migration job.
   */
  SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex chars (32 bytes)"),

  /**
   * better-auth session-cookie signing secret. `openssl rand -hex 32`.
   */
  BETTER_AUTH_SECRET: z.string().min(32),

  /**
   * Origin the SPA is served from (CORS + cookie domain). May equal
   * PUBLIC_BASE_URL when the SPA is reverse-proxied behind the API.
   */
  WEB_BASE_URL: z.string().url(),

  /**
   * Optional override of Anthropic SDK base URL. The actual API key lives
   * in the encrypted Secret store, not in env.
   */
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com"),

  /**
   * Optional override of Mailgun SDK base URL.
   */
  MAILGUN_BASE_URL: z.string().url().default("https://api.mailgun.net"),

  /**
   * Optional override for log level filtering (currently informational).
   */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = load();
