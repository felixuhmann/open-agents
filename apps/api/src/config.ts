import { z } from "zod";

/**
 * Bootstrap-only environment. Per the v1 plan, every other secret
 * (model-provider + Mailgun service credentials, per-tool secrets) is managed
 * through the web UI and persisted encrypted in Postgres. The values here
 * are the minimum the process needs to come up and decrypt the rest.
 */
/**
 * Treat an empty value as absent.
 *
 * Compose expands an unset `${FOO:-}` to an empty string rather than omitting
 * the variable, so without this an optional setting a deployment never opted
 * into would fail validation and stop the process from booting.
 */
function optional<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    inner,
  );
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Public origin of this backend (no trailing slash). Used for outbound
   * email links and generated asset URLs.
   */
  PUBLIC_BASE_URL: z.string().url(),

  /**
   * HMAC secret reserved for signed upload URLs.
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
   * Optional override of Mailgun SDK base URL.
   */
  MAILGUN_BASE_URL: z.string().url().default("https://api.mailgun.net"),

  /**
   * Optional override for log level filtering (currently informational).
   */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** Maximum wall time for one provider model request before Pi is aborted. */
  AGENT_MODEL_REQUEST_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(60 * 60)
    .default(5 * 60),

  /** Maximum wall time for one complete agent turn, including tool calls. */
  AGENT_RUN_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(22 * 60 * 60)
    .default(30 * 60),

  /** Age after which a still-running AgentRun is repaired as failed. */
  AGENT_STALE_RUN_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(23 * 60 * 60)
    .default(35 * 60),

  /**
   * Max agent runs executed concurrently per node. Runs are I/O-bound (they
   * await the remote model + Daytona sandbox), so one slow or looping run must
   * not starve the others — each worker polls independently.
   */
  AGENT_RUN_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(20),

  /** Max workflow runs executed concurrently per node. */
  WORKFLOW_RUN_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),

  /**
   * Self-hosted sandbox broker (optional).
   *
   * Absent `SANDBOX_BROKER_URL` means this deployment has no broker, which is
   * the normal state for a Daytona install — the provider simply does not
   * register. Unlike model/Daytona credentials, the broker token is
   * infrastructure rather than an admin-rotatable service secret: it
   * authenticates one private container to another over a network the browser
   * cannot reach, so it stays in the environment and out of the database.
   */
  SANDBOX_BROKER_URL: optional(z.string().url().optional()),
  SANDBOX_BROKER_TOKEN: optional(z.string().min(1).optional()),
  /** Path to a token file, typically a volume the broker generated. */
  SANDBOX_BROKER_TOKEN_FILE: optional(z.string().min(1).optional()),
  /** Exact broker build to accept. Mismatch fails readiness rather than guessing. */
  SANDBOX_BROKER_EXPECTED_VERSION: optional(z.string().min(1).optional()),

  /** Fixed resource shape of every broker sandbox this deployment creates. */
  SANDBOX_BROKER_CPU_CORES: optional(z.coerce.number().positive().max(8).default(2)),
  SANDBOX_BROKER_MEMORY_MIB: optional(
    z.coerce.number().int().min(128).max(32_768).default(2_048),
  ),
  SANDBOX_BROKER_PIDS: optional(z.coerce.number().int().min(16).max(4_096).default(512)),
  SANDBOX_BROKER_WORKSPACE_MIB: optional(
    z.coerce.number().int().min(64).max(32_768).default(4_096),
  ),
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
  if (
    parsed.data.AGENT_MODEL_REQUEST_TIMEOUT_SECONDS >=
    parsed.data.AGENT_RUN_TIMEOUT_SECONDS
  ) {
    throw new Error(
      "Invalid environment configuration:\n  - AGENT_MODEL_REQUEST_TIMEOUT_SECONDS must be less than AGENT_RUN_TIMEOUT_SECONDS",
    );
  }
  if (parsed.data.AGENT_STALE_RUN_SECONDS <= parsed.data.AGENT_RUN_TIMEOUT_SECONDS) {
    throw new Error(
      "Invalid environment configuration:\n  - AGENT_STALE_RUN_SECONDS must be greater than AGENT_RUN_TIMEOUT_SECONDS",
    );
  }
  return parsed.data;
}

export const config = load();
