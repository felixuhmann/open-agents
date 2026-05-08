# Deployment

This platform runs as a single Node process plus a Postgres database
(and a static SPA bundle served from the same Node process). The
reference targets are [Railway](https://railway.app/) and self-hosted
[Dokploy](https://dokploy.com/) using
[Railpack](https://railpack.com/), but anything that can run a Node 24
app and reach Postgres works.

## What gets deployed

One Node process per customer. **Agent definitions live in our Postgres**
and get pushed to Anthropic on demand from the **Publish to Anthropic**
button. There is no per-agent code; everything is data in the database.

The SPA at `apps/web` builds to a static `dist/` and is served from the
same Hono process via the catch-all route in
[`apps/api/src/routes/web.ts`](../apps/api/src/routes/web.ts), which
maps `/*` to `apps/web/dist/` with an `index.html` fallback for SPA
deep links. That route is mounted last in
[`apps/api/src/server/app.ts`](../apps/api/src/server/app.ts), so
every prefixed router (`/api/*`, `/mcp/*`, `/mailgun/*`, `/setup/*`,
`/health/*`, `/static/*`, plus the `/runs/...` and `/conversations/...`
upload endpoints) wins. The whole platform deploys as a single Node
service — no separate frontend container, no CDN required (though you
can still front it with Caddy / Cloudflare if you want).

## Build & start

[`railpack.json`](../railpack.json) declares:

```json
{
  "provider": "node",
  "buildAptPackages": ["openssl"],
  "packages": { "node": "24", "pnpm": "10" },
  "steps": {
    "build": {
      "commands": ["pnpm install --frozen-lockfile", "pnpm build"]
    }
  },
  "deploy": {
    "startCommand": "pnpm db:deploy && cd apps/api && node dist/index.js"
  }
}
```

The `build` step:

1. `pnpm install --frozen-lockfile` — clean install for every workspace.
   The `@open-agents/db` package's `postinstall` runs
   `prisma generate && tsc -p tsconfig.json`, producing the compiled
   client at `packages/db/dist/prisma/`.
2. `pnpm build` — `turbo run build`, which depends on
   `@open-agents/db#generate`. It compiles `apps/api` to
   `apps/api/dist/`, copies the email static assets, and builds the
   `apps/web` SPA to `apps/web/dist/`.

The `deploy` start command runs `pnpm db:deploy`
(`prisma migrate deploy` — forward-only, never `migrate dev`) and then
`node dist/index.js` from inside `apps/api/`. The `cd` matters: the email
static-asset route in
[`apps/api/src/routes/static.ts`](../apps/api/src/routes/static.ts) resolves
`./dist/emails/static` relative to the process CWD.

## Required bootstrap environment

Set every variable from
[`apps/api/.env.example`](../apps/api/.env.example) on the service. See
[`configuration.md`](configuration.md) for what each one means and how
to generate the secrets. Concretely:

- `DATABASE_URL`
- `PORT` (Railway / Dokploy / Railpack inject it for you)
- `PUBLIC_BASE_URL` — the deployed origin of the API, no trailing slash
- `WEB_BASE_URL` — the deployed origin of the SPA. With the unified
  deploy this **must equal** `PUBLIC_BASE_URL` (both set to e.g.
  `https://agents.example.com`); the SPA hits the API same-origin so
  cookies and CORS Just Work.
- `MCP_AUTH_TOKEN`
- `UPLOAD_SIGNING_SECRET`
- `SECRET_ENCRYPTION_KEY` — **64 hex chars; never rotate without
  re-encrypt job**
- `BETTER_AUTH_SECRET`

Generate the four random secrets with:

```bash
openssl rand -hex 32   # MCP_AUTH_TOKEN
openssl rand -hex 32   # UPLOAD_SIGNING_SECRET
openssl rand -hex 32   # SECRET_ENCRYPTION_KEY  (must be exactly 64 hex)
openssl rand -hex 32   # BETTER_AUTH_SECRET
```

**Anthropic and Mailgun credentials are NOT environment variables** in
v1. They are entered through the first-run setup wizard at `/setup` and
stored AES-256-GCM-encrypted in the `Secret` table. Rotation happens
through `/settings/secrets` in the UI.

## Dokploy (self-hosted Railway-style)

The Railpack build above is what Dokploy runs by default when you point
it at this repo, so the only Dokploy-specific bits are the dashboard
fields:

- **Repository / Branch**: this repo, your default branch.
- **Build Path**: leave at the repo root (`.`). `railpack.json` is
  there.
- **Watch Paths**: leave empty unless you want to filter rebuilds. With
  Turborepo's caching the cost of a no-op build is small.
- **Enable Submodules**: not needed.

Then in the app's settings:

- Provision a **Postgres database app** in Dokploy (or point at a
  managed Postgres) and copy its connection string into `DATABASE_URL`.
  The application has no other persistent state, so no volumes need
  mounting.
- Set the bootstrap env vars from
  [`apps/api/.env.example`](../apps/api/.env.example). With the
  unified deploy `WEB_BASE_URL` and `PUBLIC_BASE_URL` are the same
  value (the app's public URL). Don't set `PORT` — Dokploy injects it.
- Configure the **health check** path to `/health` (instant `200 OK`)
  or `/health/ready` (runs `SELECT 1` against Postgres — slightly
  slower but tells you the DB is reachable). Either is fine.
- Trigger a build. Once deploys are green, open the public URL in a
  browser and the SPA loads `/setup` for the first-run wizard. The
  wizard captures the Anthropic + Mailgun credentials into the
  encrypted `Secret` table.

If you want push-to-deploy, the build hook you already have on the
GitLab integration is enough — there's nothing else Dokploy needs to
know about the monorepo because Turborepo handles the per-package
build orchestration internally.

## One-time provisioning

Two things have to be set up outside the application: the Mailgun domain
and (only if any agent uses our MCP server) the Anthropic vault.

### 1. Mailgun: a single catch-all route

In the Mailgun control panel:

1. Add and verify your sending domain (`mg.example.com`).
2. Find the **HTTP webhook signing key** under _Settings → Webhooks_.
   This is **not** the API key. The setup wizard stores it.
3. Make a private API key under _Settings → API Keys_. The setup wizard
   stores it as `mailgun_api_key`.
4. **Receiving → Routes** — add **one** route that matches
   `match_recipient(".*@mg.example.com")` (a real catch-all) and forwards
   to `forward("https://<your-deploy>/mailgun/inbound")`. **No path
   parameter, no per-agent route.** The catch-all webhook resolves the
   target agent by parsing the recipient against `Agent.inboundLocalPart`.

### 2. Anthropic vault for MCP auth (only if you'll use platform MCP tools)

The Anthropic Managed Agents API attaches credentials to the MCP
handshake via a _vault_. Create one once per deployment:

```bash
curl -sS https://api.anthropic.com/v1/vaults \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{"display_name":"open-agents-backend"}'
```

The response contains `id: "vlt_..."`. Store it as `anthropic_vault_id`
in the setup wizard (or rotate it later from `/settings/secrets`).

For each agent you publish that has tool bindings, add a `static_bearer`
credential to the vault that maps the agent's MCP URL to your
`MCP_AUTH_TOKEN`:

```bash
curl -sS https://api.anthropic.com/v1/vaults/$VAULT_ID/credentials \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{
        "type": "static_bearer",
        "url": "https://<your-deploy>/mcp/<slug>",
        "token": "<MCP_AUTH_TOKEN value>"
      }'
```

The backend forwards `vault_ids: [anthropic_vault_id]` on every
`createSession` call. Anthropic uses the vault to look up the bearer
matching the MCP URL configured on the agent.

> Adding a new agent through the UI does NOT auto-add a vault credential.
> If the agent uses platform MCP tools, do step §2 manually — or, easier,
> register one credential per slug ahead of time and just publish the
> agent.

## Database migrations

The start command runs `pnpm db:deploy` (which calls
`prisma migrate deploy` against
[`packages/db/prisma.config.ts`](../packages/db/prisma.config.ts)). Two
important properties:

- **Forward-only.** Never `prisma migrate reset` against production.
- **Run before the server starts.** A migration that takes minutes will
  delay readiness; that's intentional.

To create a new migration locally:

```bash
pnpm db:migrate --name <slug>
```

Commit the generated SQL under `packages/db/prisma/migrations/`. CI /
the deploy container picks it up automatically.

Prisma 7 reads its connection URL from
[`packages/db/prisma.config.ts`](../packages/db/prisma.config.ts), which
loads `DATABASE_URL` via `dotenv`. In CI / production, set
`DATABASE_URL` directly on the host — no `.env` file is required.

## Health checks

- `GET /health` — `200 OK` immediately. Use this for liveness.
- `GET /health/ready` — runs a `SELECT 1` against the DB. Use this for
  readiness.

## Logging

JSON Lines on stdout/stderr. See [`operations.md`](operations.md) for
how to read them and what each event means. On Railway the default log
viewer is fine for grepping; for production-grade observability ship
stdout to your aggregator (Datadog, Loki, BetterStack, etc.).

## Scaling

The HTTP layer and the pg-boss workers run in the same process. Vertical
scale to a few CPUs is fine; pg-boss will pick up jobs from any number
of replicas if you go horizontal, but each replica also runs the HTTP
server, so put a load balancer in front and pin Mailgun/Anthropic at the
LB hostname.

The hot path is the run-agent worker streaming SSE from Anthropic — one
outbound HTTP connection per concurrent run. The SSE bridge from
`RunEvent` to browser EventSource adds one Postgres `LISTEN` connection
per active web-chat client.
