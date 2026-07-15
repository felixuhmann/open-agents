# Configuration

Configuration is split in two:

1. **Bootstrap environment** (`apps/api/.env`) — the minimum the process
   needs to come up, decrypt the rest, and accept HTTP requests. Validated
   by Zod in [`apps/api/src/config.ts`](../apps/api/src/config.ts) at
   process start; missing/malformed values **throw** so a healthy
   `pnpm dev` startup is itself proof your env is sane.
2. **Service credentials and per-tool secrets** — Daytona API key,
   model-provider keys, Mailgun key/domain/signing key, and any per-tool secrets. Stored
   AES-256-GCM encrypted in the `Secret` table; managed entirely through
   the web UI (`/setup` wizard the first time, then `/settings/secrets`).
3. **Plain app settings** — branding, email footer text, and the default
   outbound `From:` address. Stored in plaintext in `AppSetting`; managed
   from `/settings/general`.

[`apps/api/.env.example`](../apps/api/.env.example) is the canonical
template for the bootstrap layer.

## Bootstrap environment

### Database

| Variable       | Required | Notes                                                                                                                                                 |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | yes      | Postgres connection string. Used by Prisma, pg-boss (creates a `pgboss` schema in the same DB), and the LISTEN/NOTIFY connection in `runs/events.ts`. |

### HTTP

| Variable          | Required | Default | Notes                                                                                                                                      |
| ----------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`            | no       | 3000    | Hono server port.                                                                                                                          |
| `PUBLIC_BASE_URL` | yes      | —       | Public origin of the API (no trailing slash). Used for generated links and absolute asset URLs.                                            |
| `WEB_BASE_URL`    | yes      | —       | Public origin the SPA is served from. Drives CORS and the cookie domain. Often equal to `PUBLIC_BASE_URL` once Caddy reverse-proxies both. |

### Secrets

| Variable                | Required | Notes                                                                                                                                                       |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET_ENCRYPTION_KEY` | yes      | 64 hex chars (32 raw bytes). AES-256-GCM key for the `Secret` table. Generate with `openssl rand -hex 32`. **Rotation requires a one-shot re-encrypt job.** |
| `BETTER_AUTH_SECRET`    | yes      | 32+ chars. better-auth session-cookie signing secret. `openssl rand -hex 32`.                                                                               |
| `UPLOAD_SIGNING_SECRET` | yes      | 32+ chars. HMAC secret reserved for signed upload URLs. `openssl rand -hex 32`.                                                                             |

### Optional overrides

| Variable                              | Default                   | Notes                                                                      |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `MAILGUN_BASE_URL`                    | `https://api.mailgun.net` | Use `https://api.eu.mailgun.net` for EU.                                   |
| `LOG_LEVEL`                           | `info`                    | One of `debug` / `info` / `warn` / `error`.                                |
| `AGENT_MODEL_REQUEST_TIMEOUT_SECONDS` | `300`                     | Aborts a provider request that has not completed in time.                  |
| `AGENT_RUN_TIMEOUT_SECONDS`           | `1800`                    | Maximum wall time for a complete agent turn, including tools.              |
| `AGENT_STALE_RUN_SECONDS`             | `2100`                    | Repairs older `running` agent rows as failed; must exceed the run timeout. |

## Service credentials (managed in the UI)

Captured by the first-run wizard at `/setup` and rotatable later from
`/settings/secrets`. They are persisted encrypted in the `Secret` table with
`scope = "service"`. Service code reads them through
[`apps/api/src/secrets/service.ts`](../apps/api/src/secrets/service.ts);
the Daytona backend, model-provider key resolver, and Mailgun client read
fresh values after rotation.

| Key in `Secret.key`   | Used by                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `daytona_api_key`     | [`apps/api/src/agent-backend/instance.ts`](../apps/api/src/agent-backend/instance.ts) (sandbox runtime).    |
| `anthropic_api_key`   | [`apps/api/src/services/piModel.ts`](../apps/api/src/services/piModel.ts) (Claude model provider).          |
| `openai_api_key`      | [`apps/api/src/services/piModel.ts`](../apps/api/src/services/piModel.ts) (OpenAI model provider).          |
| `openrouter_api_key`  | [`apps/api/src/services/piModel.ts`](../apps/api/src/services/piModel.ts) (OpenRouter model provider).      |
| `mailgun_api_key`     | [`apps/api/src/mailgun/send.ts`](../apps/api/src/mailgun/send.ts) (outbound).                               |
| `mailgun_domain`      | Outbound + inbound recipient parsing.                                                                       |
| `mailgun_signing_key` | [`apps/api/src/routes/mailgun.ts`](../apps/api/src/routes/mailgun.ts) (HMAC verify of the inbound webhook). |

The plaintext value is **never** returned by the API. The list endpoint
only ever exposes `{ key, configured: boolean }`.

## Plain app settings

These values are returned as plaintext by `/api/settings` and edited from
`/settings/general`.

| Key in `AppSetting.key` | Used by                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_name`          | Browser title, setup/sign-in screens, and sidebar header.                                                                                                |
| `favicon_url`           | Browser tab icon. Falls back to the bundled `/favicon.svg` (Open Agents mark) when unset.                                                                |
| `sidebar_logo_url`      | Sidebar brand mark.                                                                                                                                      |
| `email_footer_logo_url` | Outbound email footer image.                                                                                                                             |
| `email_disclaimer`      | Outbound email footer paragraph.                                                                                                                         |
| `inbound_from`          | [`apps/api/src/jobs/sendEmail.ts`](../apps/api/src/jobs/sendEmail.ts) — last-resort `From:` for legacy threads. Per-thread `inboundAddress` always wins. |

## Per-tool secrets

Some platform MCP tools need credentials per binding (e.g. an OAuth token
for an integration). These live in the same `Secret` table with
`scope = "tool"` and a `bindingId` foreign key to `AgentToolBinding`.
Tool handlers read them via
`getToolSecrets(bindingId): Record<string, string>`.

When a binding is deleted, the cascading FK takes its secrets with it.

## Generating secrets

```bash
openssl rand -hex 32   # 64-char hex; use for SECRET_ENCRYPTION_KEY,
                       # BETTER_AUTH_SECRET, UPLOAD_SIGNING_SECRET
```

Never commit a real `.env`. The repo-level `.gitignore` covers it; double
check before any `git add`.
