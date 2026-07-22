# Deployment

Ship the platform as a **single Docker image**: the Hono API serves the built SPA,
runs pg-boss workers, and applies Prisma migrations on container start.

## Architecture

```
                    ┌─────────────────────────────┐
  Browser / Mailgun │  open-agents (Docker)       │
        ───────────▶│  :3000  API + SPA + workers │
                    │  volume: apps/api/data/skills│
                    └──────────────┬──────────────┘
                                   │ DATABASE_URL
                                   ▼
                    ┌─────────────────────────────┐
                    │  Postgres 16                │
                    └─────────────────────────────┘
```

The container entrypoint runs `prisma migrate deploy` before `node dist/index.js`.
The Node process starts with working directory `apps/api` so static assets resolve
to `../web/dist` (see `apps/api/src/routes/web.ts`).

## Quick start (Docker Compose)

For a single host or staging environment:

```bash
cp docker/.env.example docker/.env   # set real secrets
docker compose up --build -d
```

Open `http://localhost:3000` (or your `PUBLIC_BASE_URL`) and complete the
**Setup wizard**. Daytona, model-provider, and Mailgun credentials are stored in
the encrypted `Secret` table via the UI — not in env files.

Compose provisions:

- **Postgres 16** with a named volume (`postgres_data`)
- **Skill bundle storage** at `apps/api/data/skills` (`skill_bundles` volume)

Override the published port with `APP_PORT` in `docker/.env`.

## Building the image

From the repo root:

```bash
docker build -t open-agents:latest .
```

Run standalone (supply your own `DATABASE_URL` and bootstrap env):

```bash
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/open_agents?schema=public" \
  -e SECRET_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  -e UPLOAD_SIGNING_SECRET="$(openssl rand -hex 32)" \
  -e PUBLIC_BASE_URL="https://agents.example.com" \
  -e WEB_BASE_URL="https://agents.example.com" \
  -v open_agents_skills:/app/apps/api/data/skills \
  open-agents:latest
```

`PUBLIC_BASE_URL` and `WEB_BASE_URL` should match in production because the
unified deploy serves API and SPA from one origin.

## Required bootstrap env

| Variable                | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `DATABASE_URL`          | Postgres URL (Prisma + pg-boss + LISTEN/NOTIFY)         |
| `SECRET_ENCRYPTION_KEY` | 64 hex chars; AES-GCM key for the `Secret` table        |
| `BETTER_AUTH_SECRET`    | Session signing secret for better-auth                  |
| `UPLOAD_SIGNING_SECRET` | 32+ char HMAC secret for signed upload URLs             |
| `PUBLIC_BASE_URL`       | Public origin of the deployment (no trailing slash)     |
| `WEB_BASE_URL`          | SPA origin (same as `PUBLIC_BASE_URL` in Docker deploy) |

Optional: `PORT` (default `3000`), `LOG_LEVEL`, `MAILGUN_BASE_URL`,
`SKILL_BUNDLE_DIR` (absolute or relative to `apps/api`), and the agent timeout
controls `AGENT_MODEL_REQUEST_TIMEOUT_SECONDS`, `AGENT_RUN_TIMEOUT_SECONDS`,
and `AGENT_STALE_RUN_SECONDS`.

Service credentials are stored in the encrypted `Secret` table, not env.
Configure them through the setup wizard and **Settings → Secrets**:

- `daytona_api_key` for the Daytona sandbox provider (not needed if you run the self-hosted broker instead)
- `anthropic_api_key`, `openai_api_key`, or `openrouter_api_key` for models
- `mailgun_api_key`, `mailgun_domain`, and `mailgun_signing_key` for email

See [`configuration.md`](configuration.md) for details.

## Health checks

- `GET /health/` — process liveness (no database)
- `GET /health/ready` — returns 503 until Postgres is reachable

The Dockerfile `HEALTHCHECK` probes `/health/ready`. Wire the same path in
your orchestrator (Kubernetes, ECS, Fly.io, etc.).

## Mailgun

Configure a single catch-all inbound route to `POST /mailgun/inbound` on your
public `PUBLIC_BASE_URL`. The webhook resolves the target agent from the
recipient local part.

## Sandbox providers

Agent sandboxes run on one of two providers, chosen deployment-wide in Setup
and changeable in **Settings → Sandboxes**. **A deployment that has never made
a choice runs on Daytona**, so nothing here is required to keep an existing
install working.

### Daytona (default)

Set `daytona_api_key` before running agents. Nothing else to host.

### Self-hosted broker

Hardened Docker containers on your own host, with no third-party account and no
per-sandbox ports. It ships as a Compose profile that is off by default:

```bash
COMPOSE_PROFILES=broker DOCKER_GID=$(getent group docker | cut -d: -f3) \
  docker compose up -d --build
```

Then set `SANDBOX_BROKER_URL=http://sandbox-broker:8080` in `docker/.env`.

The broker publishes **no host port** and gets **no public route**; it is
reached by service name on an `internal` Compose network shared only with the
app. It is the **only** container that receives `/var/run/docker.sock` — the
app, PostgreSQL, and the sandboxes never do. PostgreSQL stays off that network
entirely. Isolation is standard Docker/runc on a shared kernel, which is a
single-tenant design and not a boundary against a kernel escape.

By default the broker generates its own bearer token onto a shared volume that
the app mounts read-only, so no new secret has to be supplied by hand. Full
setup, image pinning, network-policy semantics, and the threat model are in
[`docker/sandbox-broker/README.md`](../docker/sandbox-broker/README.md).

### Either way

Sandboxes are tracked in `AgentSandbox` with the provider that created them;
the reconcile worker syncs provider state, stops stale sandboxes, and clears
pointers for missing sandboxes. A provider that is unavailable does not block
reconciliation of the other.

## Persistent data

Persist in production:

1. **Postgres** — all application state, jobs, and run events
2. **`apps/api/data/skills/`** — skill bundle zips (mount a volume at this path)

Without the skills volume, uploaded bundles are lost on container recreate and
sandboxes cannot rematerialize pinned skill versions.

If you run the broker, its `broker_auth` volume holds the generated token and
sandbox workspaces live in broker-owned volumes; both are recreated as needed,
but deleting `broker_auth` rotates the credential and requires an app restart.

## Kubernetes / PaaS notes

- Run **one replica** unless you coordinate pg-boss workers (the queue uses
  Postgres locking; multiple replicas are supported for the HTTP tier but
  understand duplicate cron/reconcile scheduling).
- Set `DATABASE_URL` to a managed Postgres instance; do not bundle Postgres in
  the app image.
- Mount `apps/api/data/skills` as a `PersistentVolumeClaim` or object-storage
  sync if you run multiple app replicas.
- Terminate TLS at your ingress; the container speaks plain HTTP on `PORT`.

## Local development

Docker Compose is optional for day-to-day development. Most contributors use
`pnpm dev` with a local Postgres instance — see
[`local-development.md`](local-development.md).
