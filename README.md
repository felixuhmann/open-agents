# open-agents

<img width="2476" height="1393" alt="grafik" src="https://github.com/user-attachments/assets/164554bf-3143-4f6a-b9a4-48052fce315c" />

Deploy custom ai agents that bring real value to your org in minutes. No coding required. Upload your skill bundles. Select tools for the agent. Sandboxed in the cloud. Observable by default.

Single-tenant agent platform powered by Daytona sandboxes and Pi.
One deployment per customer; admins create, configure, and share agents
through a web UI without writing any code.

```
Browser SPA ──▶ Hono API ──▶ Postgres + pg-boss ──▶ Daytona sandbox + Pi loop
                  │
                  └──▶ Mailgun (catch-all webhook)
```

Each agent has up to two surfaces:

- **Web chat** at `/agents/<slug>/chat`. Durable: the worker streams agent
  events into an append-only `RunEvent` log; the SSE handler replays the
  backlog on reconnect and switches to live `LISTEN/NOTIFY`.
- **Email** at `<localPart>@<MAILGUN_DOMAIN>`, fed by a single catch-all
  Mailgun route. Email and chat never share state.

The agent definition (system prompt, tools, skills, third-party MCP servers,
ACL, surface toggles) is owned by **our** Postgres. Publishing freezes a local
`AgentVersion` snapshot; Daytona is the runtime and Postgres is the source of
truth.

## Repo layout

```
.
├── apps/
│   ├── api/        Hono backend + pg-boss workers + Daytona orchestration
│   └── web/        Vite + React + TanStack Query + better-auth/react SPA
├── packages/
│   ├── db/         Prisma 7 schema + generated client (@open-agents/db)
│   ├── types/      Shared Zod DTOs / enums (@open-agents/types)
│   └── tsconfig/   Base tsconfigs
├── docs/           Architecture, ops, dev guides
├── pnpm-workspace.yaml
└── turbo.json
```

## Quick start (local development)

```bash
cp apps/api/.env.example apps/api/.env  # fill in real values
pnpm install                             # also runs `prisma generate` + `tsc` in @open-agents/db
pnpm db:migrate                          # creates tables in DATABASE_URL
pnpm dev                                 # turbo runs api + web together
```

Open `http://localhost:5173`. The first request will redirect you to the
**Setup wizard**, where you create the first admin user and paste your
Daytona, model-provider, and Mailgun credentials. Everything else (creating agents,
uploading skills, rotating secrets) happens in the SPA from there.

Required bootstrap environment (see `[apps/api/.env.example](apps/api/.env.example)`):

| Variable                | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `DATABASE_URL`          | Postgres URL (Prisma + pg-boss + LISTEN/NOTIFY share) |
| `SECRET_ENCRYPTION_KEY` | 32-byte hex; AES-GCM key for the `Secret` table       |
| `BETTER_AUTH_SECRET`    | Session signing secret for better-auth                |
| `WEB_BASE_URL`          | Public origin of the SPA (CORS + cookie domain)       |
| `PUBLIC_BASE_URL`       | Public origin of the API                              |
| `UPLOAD_SIGNING_SECRET` | 32+ char HMAC secret reserved for signed upload URLs  |

Daytona, model-provider, and Mailgun key/domain/signing key are **not**
environment variables. They live AES-GCM encrypted in the `Secret` table
and are managed from **Settings → Secrets** in the UI.

Branding values, email footer copy, and the default outbound `From:`
header live in the plaintext `AppSetting` table and are edited from
**Settings → General**.

## Documentation

- `[AGENTS.md](AGENTS.md)` — repo-wide conventions and "where does X live"
  for coding agents.
- `[docs/architecture.md](docs/architecture.md)` — system overview, data
  model, and request lifecycles.
- `[docs/local-development.md](docs/local-development.md)` — full dev loop
  including the email preview server.
- `[docs/deployment.md](docs/deployment.md)` — Railpack build, single
  Mailgun route, and service configuration.
- `[docs/operations.md](docs/operations.md)` — logging, retries, and how
  to debug a sideways run.
- `[docs/mcp-tools.md](docs/mcp-tools.md)` — registering platform tools
  and external MCP servers for Daytona runs.

## Key technologies

- [Hono](https://hono.dev/) — HTTP router (Web-standard fetch handlers).
- [Prisma 7](https://www.prisma.io/) — Postgres schema + client.
- [pg-boss](https://github.com/timgit/pg-boss) — durable job queue, on the
  same Postgres.
- [better-auth](https://www.better-auth.com/) — email/password auth +
  admin/member roles. Public sign-up is disabled.
- `[@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)`
  — client support for third-party MCP servers.
- [Vite](https://vitejs.dev/) + [React 19](https://react.dev/) +
  [TanStack Query](https://tanstack.com/query) — the SPA.
- [Tailwind CSS 4](https://tailwindcss.com/) — styling.
- `[mailgun.js](https://www.npmjs.com/package/mailgun.js)` — outbound API.
- `[react-email](https://react.email/)` — HTML email templates for replies.

## License

Released under the [MIT License](LICENSE).
