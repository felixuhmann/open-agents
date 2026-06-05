# AGENTS.md

Guide for coding agents (Claude, Cursor, Copilot, etc.) working in this repo.
Humans, see [`README.md`](README.md) for product context.

## What this codebase is

Single-tenant **agent platform**. One Postgres-backed deployment hosts many
agents that an admin creates, configures, and shares from a web UI. Each
agent has a chat surface (`/agents/<slug>/chat`) and an optional email
surface (catch-all Mailgun route → recipient `<localPart>@<MAILGUN_DOMAIN>`).

The runtime is split across two apps in a Turborepo monorepo:

- [`apps/api`](apps/api/) — Hono backend + better-auth + pg-boss workers +
  Daytona sandbox orchestration, platform tools, third-party MCP, and Mailgun.
- [`apps/web`](apps/web/) — Vite + React + TanStack Query + better-auth/react
  SPA. The single control-plane UI for the deployment.

Shared code lives in [`packages/`](packages/):

- [`packages/db`](packages/db/) — Prisma 7 schema, `prisma.config.ts`,
  and the compiled generated client re-exported as `@open-agents/db` (see
  the "Database (Prisma 7)" section below for the layout).
- [`packages/types`](packages/types/) — Zod-typed DTOs and enums shared
  between API and web.
- [`packages/tsconfig`](packages/tsconfig/) — base TS configs (`node`,
  `react`).

Agent definitions (system prompt, tools, skills, `mcp_servers`) are stored
in **our** database. Publishing freezes the current draft into an
`AgentVersion` snapshot; Daytona is the runtime and Postgres is the source
of truth.

## High-level data flow

```
Browser (SPA) ─────────────▶ Hono /api/*  ──▶ Postgres (Prisma)
       ▲                          │
       │                          └──▶ pg-boss queue
       │                                  │
       │                                  ▼
       │                          run-agent worker
       │                          ├─ Daytona sandbox resources
       │                          ├─ Pi model/tool loop
       │                          └─ writes RunEvent rows + NOTIFY
       │
       └─ EventSource /api/runs/:id/events ◀── Postgres NOTIFY

Mailgun ──▶ POST /mailgun/inbound  ──▶ resolve agent by recipient ──▶ enqueue run-agent
                                                                            │
                                                                            ▼
                                                                       send-email worker ──▶ Mailgun
```

Web chat is durable: the HTTP `POST /api/conversations/:id/messages` only
enqueues a job; the worker streams Daytona/Pi events into the `RunEvent`
append-only table; the SSE handler replays from `Last-Event-ID` and
switches to live `LISTEN/NOTIFY`. If the browser drops, the run keeps
going and the page picks up where it left off on reconnect.

## Repo layout

```
.
├── apps/
│   ├── api/                       Hono + workers + MCP
│   │   └── src/
│   │       ├── index.ts           bootstrap
│   │       ├── server/            app builder, lifecycle, types
│   │       ├── auth/              better-auth wiring + middleware
│   │       ├── secrets/           AES-GCM Secret service + readers
│   │       ├── agents/service.ts  CRUD + cache + publishAgent()
│   │       ├── mcp/
│   │       │   ├── piTools.ts     host-side platform + third-party MCP tools
│   │       │   └── platform/      code-shipped tool handlers (memory, …)
│   │       ├── runs/events.ts     RunEvent + NOTIFY/LISTEN + SSE
│   │       ├── jobs/              pg-boss workers (run-agent, send-email)
│   │       ├── mailgun/           parse / verify / send
│   │       ├── services/          domain logic (chat, threads, sessions, …)
│   │       └── routes/
│   │           ├── api/           /api/{agents,users,…}
│   │           ├── auth.ts        better-auth catch-all
│   │           ├── mailgun.ts     single catch-all webhook
│   │           └── upload.ts      cookie-auth conversation uploads
│   └── web/                       Vite + React control-plane SPA
├── packages/
│   ├── db/                        @open-agents/db — Prisma 7 schema, prisma.config.ts,
│   │                              generated/ (TS source from `prisma generate`),
│   │                              dist/ (tsc-compiled JS + d.ts → exported)
│   ├── types/                     shared Zod DTOs / enums
│   └── tsconfig/                  base tsconfigs
├── docs/                          architecture, ops, dev guides
├── pnpm-workspace.yaml
└── turbo.json
```

## Conventions

### Imports

- ESM with `module: NodeNext`. Relative imports MUST end in `.js` even
  though the source is `.ts`:
  ```ts
  import { config } from "./config.js";
  ```
- Type-only imports use `import type { Foo } from "..."`. ESLint enforces
  it.
- The Prisma client is consumed exclusively as `@open-agents/db`. Do NOT
  `import { PrismaClient } from "@prisma/client"`, and do NOT import
  from the generated path (`packages/db/generated/...`) — those are
  internals, the package exports field is the contract.

### Adding a new agent

There is no longer a code path. Agents are created through the SPA:

1. Sign in as admin, go to `/agents`, click **New agent**, choose a slug.
2. On the edit page set the system prompt, optional **chat starter prompts**
   (empty-state suggestion chips on web chat), pick the model, toggle
   web/email surfaces, tick whatever **Tools** the agent needs (managed +
   platform live in the same picker, grouped by runtime), attach skill
   bundles, paste any third-party MCP server URLs.
3. Click **Publish new version** — the backend freezes the current draft
   config into an `AgentVersion` snapshot (system prompt, model, tools,
   skills, MCP servers, runtime settings). Runs pin the version they
   started with for later audit.
4. The agent is immediately reachable at `/agents/<slug>/chat` (if web
   enabled) and at `<localPart>@<MAILGUN_DOMAIN>` (if email enabled).

There is no per-agent Mailgun route configuration. The catch-all webhook
at `POST /mailgun/inbound` resolves the target agent by parsing the
recipient address against `Agent.inboundLocalPart`.

### Tools (unified catalog)

Every capability the agent can call is a row in the `Tool` catalog,
discriminated by `runtime`:

- `managed` — the Daytona sandbox executes the tool (`bash`, `read`, `write`,
  `edit`, `glob`, `grep`, `web_fetch`, `web_search`).
- `platform` — this backend executes the tool through a `PlatformHandler` registered in
  [`apps/api/src/mcp/platform/index.ts`](apps/api/src/mcp/platform/index.ts).

Both runtimes share one binding table (`AgentToolBinding`) and one UI
picker. Daytona translates bindings to Pi tools at run time; the rest of
the codebase just sees `Tool` + `AgentToolBinding`.

External (user-supplied) MCP servers stay separate as
`McpServer` + `AgentMcpBinding` — deployment-wide MCP library entries attached per agent.

#### Defining a platform tool

Platform tools (`memory`, future `drive_search`, etc.) are code-shipped
handlers. Each handler exposes a list of `defineTool(...)` descriptors
backed by a Zod schema:

```ts
import { z } from "zod";
import { defineTool } from "../types.js";

export const memoryTools = [
  defineTool({
    name: "memory_create",
    description: "…",
    input: z.object({
      collection: z.string().min(1),
      doc: z.record(z.unknown()),
    }),
    handler: async (input, ctx) => {
      // input is parsed and typed; ctx carries agentId + bindingId
    },
  }),
];
```

Append the handler to `PLATFORM_HANDLERS`. A boot-time
[`seedToolCatalog()`](apps/api/src/services/seedToolCatalog.ts) call
upserts a `Tool` row (with `runtime = platform`) and also seeds the
Daytona-managed sandbox tool rows. Don't insert `Tool` rows by hand.

### Database (Prisma 7)

The schema lives at
[`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma).
Prisma 7 conventions:

- `schema.prisma` declares the `prisma-client` generator with
  `output = "../generated/prisma"`. The `datasource` block carries only
  the `provider = "postgresql"`.
- The connection URL, migration directory, and any other CLI knobs live
  in [`packages/db/prisma.config.ts`](packages/db/prisma.config.ts) (the
  v7 replacement for inline `url = env(...)` in the schema). The config
  loads `.env` explicitly through `dotenv` because Prisma 7 no longer
  auto-loads — it tries the repo root first, then `apps/api/.env`, then
  `packages/db/.env`.
- `prisma generate` emits **TypeScript source** to
  `packages/db/generated/prisma/` (v7 has no JS-only output mode for
  `prisma-client`). `tsc -p tsconfig.json` then compiles those into
  `packages/db/dist/prisma/`. Both steps run in `postinstall`, so a clean
  `pnpm install` produces a usable `@open-agents/db`.
- The Prisma client requires a **driver adapter** in v7 — there is no
  Rust query engine for SQL providers. We use
  [`@prisma/adapter-pg`](https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers#postgresql)
  (backed by the `pg` driver, which is also a runtime dep already for
  the LISTEN/NOTIFY connection in `runs/events.ts`). The client
  singleton lives at
  [`apps/api/src/db.ts`](apps/api/src/db.ts).
- Consumers always import from `@open-agents/db`; never reach into
  `@prisma/client` or the generated path directly. Sub-paths
  `@open-agents/db/models`, `@open-agents/db/enums`, and
  `@open-agents/db/browser` exist for narrower bundles when they help.

After editing the schema:

```bash
pnpm db:migrate -- --name <slug>   # runs `prisma migrate dev` in packages/db
pnpm db:generate                    # only needed if you skipped postinstall
```

Apply migrations in production with `pnpm db:deploy`
(`prisma migrate deploy`, forward-only).

### Logging

Use the structured `log` helper from `apps/api/src/log.ts`. Don't
`console.log` directly — ESLint will flag it. Pass context as a meta
object:

```ts
log.info("run-agent: stream finished", { runId, sessionId, outputChars });
```

### Error handling at job boundaries

Workers wrap their handler in try/catch, persist failure state to the
relevant DB row (`AgentRun.status = "failed"`), emit a `run.failed`
`RunEvent`, and re-throw so pg-boss can retry. The canonical pattern
lives in [`apps/api/src/jobs/runAgent.ts`](apps/api/src/jobs/runAgent.ts).

## Required commands after edits

Always run before committing:

```bash
pnpm check
```

That runs `turbo run typecheck lint` (cached, per workspace) and then a
workspace-wide `prettier --check`. All must be green.

If you touched the Prisma schema, also run `pnpm db:migrate --name <slug>`.

## Common gotchas

- **New attachments mount into existing Daytona sandboxes** via
  `mountSessionResources`; don't rotate sessions just to add files.
- **Service credentials are not env vars**: Daytona / model-provider / Mailgun keys live
  AES-GCM encrypted in the `Secret` table and are read via
  [`secrets/service.ts`](apps/api/src/secrets/service.ts). The only
  bootstrap envs are `DATABASE_URL`, `SECRET_ENCRYPTION_KEY`,
  `BETTER_AUTH_SECRET`, `UPLOAD_SIGNING_SECRET`,
  `WEB_BASE_URL`, `PUBLIC_BASE_URL` (see `apps/api/.env.example`).
- **Email and chat never cross-pollinate**: each surface has its own
  thread/conversation table and creates independent backend sessions.
  Don't try to share state between them.
- **Daytona skills materialize at sandbox creation**: When
  `DAYTONA_API_KEY` is set, `DaytonaAgentBackend.createSession` resolves the
  sandbox's actual working directory via `resolveSandboxWorkspaceDir` (some
  TS sandbox images use `/home/daytona` rather than `/workspace`) and
  unpacks each pinned `AgentSkillBinding` into `<workspaceDir>/.agents/skills/<slug>/`
  via [`materializeSkills.ts`](apps/api/src/services/materializeSkills.ts).
  Bundle bytes live on disk under `apps/api/data/skills/` (see
  `SKILL_BUNDLE_DIR`); mount that directory persistently in production.
  Resumed sandboxes keep whatever was copied when they were first created;
  changing skill bindings mid-conversation does not re-sync until a new
  session is forced.
- **MCP runs on the orchestrator**: Platform tools and third-party
  MCP servers are wired into the Pi loop via
  [`apps/api/src/mcp/piTools.ts`](apps/api/src/mcp/piTools.ts) (host-side).
- **Control-plane MCP server**: The deployment also **hosts** a Streamable
  HTTP MCP endpoint at `/mcp` so external clients (Claude Desktop, etc.) can
  manage agents and settings. It proxies through the same REST handlers via
  `api_request` — see [`docs/mcp-server.md`](docs/mcp-server.md). Auth uses
  OAuth discovery (recommended for Claude Desktop connectors) or the
  better-auth `bearer()` plugin for manual session tokens.
- **Run attachments use `attach_run_file`**: The Pi loop exposes
  `attach_run_file`, which pulls
  bytes from the sandbox on the orchestrator and stores `AgentAttachment` rows.
- **Daytona sandbox lifecycle**: First-class metadata lives in the
  `AgentSandbox` table (`provider`, `providerSandboxId`, `state`,
  `lastActivityAt`, lifecycle policy JSON, links to agent + conversation/thread).
  Session ids on conversations/threads remain `daytona:{agentId}:{sandboxId}`.
  Admins manage sandboxes at `/settings/sandboxes` (`GET/POST /api/sandboxes/*`).
  A pg-boss `sandbox-reconcile` job (every 6h) syncs provider state, stops stale
  VMs, and clears pointers when sandboxes are gone. New chat attachments mount into
  the existing sandbox via `mountSessionResources` (no forced session rotation).

## Local development

```bash
pnpm install               # installs deps + runs prisma generate + tsc in @open-agents/db
pnpm db:migrate            # creates / updates tables
pnpm dev                   # turbo runs api + web together
```

`pnpm install` runs `prisma generate && tsc` inside `@open-agents/db` via
`postinstall`, so a fresh checkout gives you a working client without
any extra commands.

Default ports: `apps/api` on `:3000`, `apps/web` on `:5173` (Vite proxies
`/api`, `/mcp`, `/mailgun`, `/setup`, `/health`, `/runs`, `/conversations`,
`/static` back to the API). Visit `http://localhost:5173` and complete the
setup wizard to create the first admin and store credentials.

Expose the API with ngrok / Tailscale Funnel so Mailgun can reach
`/mailgun/inbound`.

## Docker deployment

Production ships as a single image (API + built SPA). See
[`docs/deployment.md`](docs/deployment.md).

```bash
cp docker/.env.example docker/.env
docker compose up --build
```

The container entrypoint runs `prisma migrate deploy` before starting the API.
Mount a volume at `apps/api/data/skills` for skill bundle persistence.

## Cursor Cloud specific instructions

### Prerequisites already installed on the VM

- **Node.js 24.x** via nvm (default alias set to 24)
- **pnpm 10.33.4** via corepack
- **PostgreSQL 16** (Ubuntu package); cluster `16/main` on port 5432.
  User `postgres` password is `postgres`. Auth is `md5` for local TCP.

### Starting services

1. Ensure Postgres is running: `sudo pg_ctlcluster 16 main start`
2. Create the database (first time only):
   `PGPASSWORD=postgres psql -U postgres -h localhost -c "CREATE DATABASE open_agents;"`
3. Apply migrations: `cd packages/db && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/open_agents?schema=public" npx prisma migrate deploy`
4. Start dev: `pnpm dev` (runs API on :3000 and Vite on :5173 via turbo)

### Non-obvious gotchas

- The `serveStatic` warning about `../web/dist` not existing is expected in dev mode; the Vite dev server serves the SPA directly.
- `pnpm check` includes a `prettier --check` that may fail on pre-existing formatting issues in the repo — typecheck + lint are the important gates.
- The setup wizard (`POST /api/setup`) can only run once (while `user` table is empty). After that, credential changes go through the admin Settings UI.
- `apps/api/.env` is the single env file; `packages/db/prisma.config.ts` loads it via dotenv. If you change `DATABASE_URL`, it takes effect in both Prisma CLI and the running API.
- The `msw` build script warning from pnpm is benign (test mock library, not needed at runtime).
