# Local development

How to run the platform on your laptop, including the bits Mailgun and
Anthropic care about (a public URL pointing at your machine).

## Prerequisites

- **Node.js 24.x.** Pinned in `.nvmrc` and `package.json#engines`. Use
  `nvm use` (or `fnm use`) before installing.
- **pnpm 10+.** This is a Turborepo + pnpm workspace; npm/yarn won't link
  the internal packages correctly.
- **Postgres**, anywhere. Easiest is Docker:
  ```bash
  docker run --name open-agents-pg \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=open_agents -p 5432:5432 -d postgres:16
  ```
- A **public tunnel** to expose `http://localhost:3000` to Mailgun and
  Anthropic when you want to exercise email or MCP callbacks. Any of
  [ngrok](https://ngrok.com/),
  [Tailscale Funnel](https://tailscale.com/kb/1223/tailscale-funnel),
  or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  work. Pick one with a stable hostname so you don't have to re-update
  Mailgun/Anthropic on every restart. (Pure web-chat development can skip
  the tunnel entirely — it's same-origin in dev.)

## First-time setup

```bash
cp apps/api/.env.example apps/api/.env  # fill in real values; see configuration.md
pnpm install                            # also runs `prisma generate` + `tsc` in @open-agents/db
pnpm db:migrate                         # creates schema in DATABASE_URL
pnpm dev                                # turbo runs api + web together
```

`pnpm install` triggers `prisma generate && tsc -p tsconfig.json` inside
`packages/db` via `postinstall`. The first builds the Prisma 7 client TS
source under `packages/db/generated/prisma/`; the second compiles it to
`packages/db/dist/prisma/`, which is what `@open-agents/db`'s `exports` map
points at.

`pnpm dev` runs Turbo's dev pipeline:

- `apps/api` — `tsx watch src/index.ts` on `http://localhost:3000`.
- `apps/web` — `vite` on `http://localhost:5173`. Vite proxies `/api`,
  `/mcp`, `/mailgun`, `/setup`, `/health`, `/runs`, `/conversations`,
  and `/static` to `:3000`, so the SPA looks like a single origin.

## First boot: the setup wizard

Visit `http://localhost:5173`. The first request will redirect to
`/setup` because `Secret` is empty and there are no users yet. The
wizard:

1. Asks for the first admin email + password (creates the better-auth
   `User` row with `role = "admin"`).
2. Stores the Anthropic API key, Mailgun key, domain, signing key, and
   default outbound `From:` address into the
   encrypted `Secret` table.
3. Marks setup complete; subsequent requests bypass the redirect.

After the wizard, sign in at `/login`, then create your first agent
from `/agents`.

## The development inner loop

### Web chat (no tunnel needed)

1. Sign in.
2. `/agents` → **New agent**, fill in slug + display name.
3. On the edit page set the system prompt and click **Publish to
   Anthropic** (this calls `POST /v1/agents/{id}` and stamps
   `Agent.anthropicAgentId`).
4. Open `/agents/<slug>/chat` in a new tab and send a message.
5. Watch `apps/api`'s logs and the SSE stream in DevTools.

### Email (tunnel required)

1. Run a tunnel, e.g. `ngrok http 3000`, and copy the public URL.
2. In **Mailgun → Receiving → Routes**, create **one** catch-all route
   that forwards to `https://<your-tunnel>/mailgun/inbound`. (You only
   need to do this once per deployment — every agent's inbound address
   funnels through it.)
3. From `/agents/<slug>/edit`, toggle **Email enabled** and set the
   inbound local-part. The agent's address becomes
   `<localPart>@<MAILGUN_DOMAIN>`.
4. Email that address from any client.
5. Watch the structured logs — every step (`mailgun inbound: received`,
   `run-agent: streaming`, `send-email: done`) prints a line tagged
   with `reqId` / `runId` / `agentId`.

### MCP callbacks (tunnel required for any agent that uses tools)

When you publish an agent with tool bindings, the payload includes a
`mcp_servers[].url` of `https://<PUBLIC_BASE_URL>/mcp/<slug>`. For local
testing, set `PUBLIC_BASE_URL` in `apps/api/.env` to your tunnel URL
(not `http://localhost:3000`) before starting the API, then re-publish
the agent so Anthropic picks up the new URL.

## Useful commands

```bash
pnpm dev                   # turbo dev (api: tsx watch, web: vite)
pnpm typecheck             # turbo typecheck across the workspace
pnpm lint                  # turbo lint across the workspace
pnpm format                # prettier --check
pnpm check                 # typecheck + lint + format (run before committing)
pnpm format:write          # auto-fix formatting
pnpm db:generate           # rerun `prisma generate` in @open-agents/db
pnpm db:migrate            # apply schema changes locally (`prisma migrate dev`)
pnpm db:studio             # Prisma Studio GUI on DATABASE_URL
```

`pnpm check` is what the project requires to be green before any
commit; CI runs the same thing.

## Editing email templates

[`apps/api/src/emails/`](../apps/api/src/emails/) holds the
[react-email](https://react.email/) templates. They have a hot-reloading
preview server:

```bash
pnpm --filter @open-agents/api email   # dev server on http://localhost:3001
```

Drop new image assets into
[`apps/api/src/emails/static/`](../apps/api/src/emails/static/) (PNG/JPG
only — SVG/WEBP are unreliable in many email clients). In production the
Hono app serves them at `${PUBLIC_BASE_URL}/static/<file>` (the build
step copies the folder to `dist/emails/static/`).

Reference them from a template via the shared static prefix; for one-off
brand images you can also configure the email-footer logo from
**Settings → General** (the value is read at send time and joined with
`PUBLIC_BASE_URL` when relative).

## Resetting state

When something gets wedged (orphan jobs, half-uploaded attachments,
sessions you'd rather forget), nuking and recreating the database is the
fastest path:

```bash
pnpm --filter @open-agents/db exec prisma migrate reset
```

This also drops the `pgboss` schema, so any in-flight queue jobs are
gone. That's usually what you want during local dev. After the reset the
SPA will redirect you back to `/setup` to recreate the first admin and
re-store credentials.

## Troubleshooting common dev issues

- **`Invalid environment configuration`** — read the bullet list. Each
  line points at the offending env var.
- **Browser keeps redirecting to `/setup`** — the `Secret` table is
  empty (or the `User` table has no admin). Complete the wizard once.
- **`mailgun inbound: signature mismatch`** — the signing key stored in
  `Secret` is the API key, not the HTTP webhook signing key. Use the
  one under _Settings → Webhooks → HTTP webhook signing key_.
- **`mailgun inbound: agent not found`** — the recipient's local part
  doesn't match any `Agent.inboundLocalPart`. Either fix the address,
  edit the agent, or accept that the catch-all dropped it.
- **`mcp: unauthorized` from Anthropic** — `MCP_AUTH_TOKEN` here
  doesn't match the bearer in the Anthropic vault. Either rotate via
  the Anthropic Console or update env and restart.
- **Web chat stays at "Send" with no SSE updates** — the worker isn't
  consuming jobs. Check `pg-boss started` in the logs and that
  `DATABASE_URL` matches what the API is using.
- **`prisma generate` ESM error on Node 18/20** — Prisma 7 needs Node 24. Run `nvm use` (the `.nvmrc` pins to 24).

For more, see [`operations.md`](operations.md).
