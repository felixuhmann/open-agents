# Deployment

Ship the application as a **single Docker image**: the Hono API serves the built SPA,
runs pg-boss workers, and applies Prisma migrations on container start.

> **Production sandbox requirement:** deploy OpenSandbox on Kubernetes with the
> `kata-qemu` RuntimeClass by following [OpenSandbox on k3s with Kata](./opensandbox-kubernetes.md).
> Docker-mode OpenSandbox is retained only under the explicit
> `docker-opensandbox-diagnostic` Compose profile. Live verification showed that
> Docker's host-side `dns+nft` sidecar is not a reliable enforcement boundary for
> traffic crossing the Kata VM tap path.

## Architecture

```text
Browser / Mailgun -> Open Agents app -> Postgres
                              |
                              v
                   OpenSandbox Server (k3s)
                              |
                              v
                   BatchSandbox pod (kata-qemu)
                    guest + egress in one KVM VM
```

The Open Agents application receives no Docker/containerd socket or Kubernetes
credential. Runtime access is confined to the OpenSandbox Kubernetes controller
and snapshot jobs when snapshot support is explicitly configured.

The container entrypoint runs `prisma migrate deploy` before `node dist/index.js`.
The Node process starts with working directory `apps/api` so static assets resolve
to `../web/dist` (see `apps/api/src/routes/web.ts`).

## Quick start (Docker Compose)

For a single-host application deployment, first deploy OpenSandbox using the
Kubernetes guide and set `OPENSANDBOX_BASE_URL` to its private/internal endpoint:

```bash
cp docker/.env.example docker/.env   # set every blank secret and OpenSandbox endpoint

docker compose --env-file docker/.env -p open-agents up --build -d
```

The default Compose project starts only Open Agents and Postgres. The diagnostic
Docker OpenSandbox profile is not a production deployment and must not be used
as a substitute for the Kubernetes/Kata setup.

Open `http://localhost:3000` (or your `PUBLIC_BASE_URL`) and complete the
**Setup wizard**. Model-provider and Mailgun credentials are stored in
the encrypted `Secret` table via the UI — not in env files. Model-provider keys
remain optional during setup; the wizard no longer collects a sandbox-runtime
credential (the OpenSandbox runtime is deployment env configuration, see
[OpenSandbox + Kata](#opensandbox--kata) below).

Compose provisions:

- **Postgres 16** with a named volume (`postgres_data`)
- **Open Agents API + SPA + workers**, configured to call the external private OpenSandbox endpoint
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
  -e OPENSANDBOX_BASE_URL="http://host.docker.internal:8080" \
  -e OPENSANDBOX_API_KEY="$OPENSANDBOX_API_KEY" \
  -e OPENSANDBOX_IMAGE="open-agents-opensandbox-guest:1.0.0" \
  --add-host host.docker.internal:host-gateway \
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

The sandbox runtime is configured through `OPENSANDBOX_*` env vars, not a
secret — see [OpenSandbox + Kata](#opensandbox--kata) below.

Service credentials are stored in the encrypted `Secret` table, not env.
Configure them through the setup wizard and **Settings → Secrets**:

- `anthropic_api_key`, `openai_api_key`, or `openrouter_api_key` for models (optional during setup)
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

## OpenSandbox + Kata

The sandbox runtime is a self-hosted **OpenSandbox Server + Kata Containers**
stack, run as a dedicated `opensandbox` Docker Compose service. There is no
external SaaS.

**Docker-socket isolation.** Only the `opensandbox` service is granted the host
Docker socket, so it — and nothing else — can spawn sandbox containers. The
Node `app` service never receives the socket. This keeps the runtime that
launches untrusted agent workloads separate from the API process.

**Kata host prerequisite.** The host must expose `/dev/kvm`, support hardware
virtualization, and register Kata with Docker as `kata-runtime`. The mounted
`docker/opensandbox/config.toml` selects `[secure_runtime] type = "kata"` and
`docker_runtime = "kata-runtime"`; startup fails rather than falling back to
`runc` when that runtime is unavailable.

Run these checks before Compose. On nested/cloud VMs, the provider must expose
nested VT-x/AMD-V; seeing the device alone is insufficient.

```bash
test -c /dev/kvm
docker info --format '{{json .Runtimes}}' | grep 'kata-runtime'
docker run --rm --runtime kata-runtime alpine:3.20 uname -a
```

The last command must boot and report a Kata guest kernel. Also verify the
host's `kvm_intel` or `kvm_amd` module is loaded and that the installed Kata,
kernel, and Docker versions are supported together.

**Pinned runtime images.** Compose builds both the Node 24 guest image and a
hardened OpenSandbox egress image before starting the lifecycle server:

```bash
docker compose --env-file docker/.env -p open-agents build \
  opensandbox-guest-image opensandbox-egress-image
```

OpenSandbox's Docker backend currently publishes the randomly allocated
execd/HTTP/egress ports on all host interfaces and execd does not authenticate
those direct endpoints. The `DOCKER-USER` rules in Quick start are therefore a
**mandatory security control**, not optional hardening. Persist equivalent
rules with the host firewall manager and verify an external host cannot connect
to TCP `40000:41000`; only the `open-agents_default` subnet may reach it.

**App-side env.** The `app` service reaches the runtime through these vars (see
[`configuration.md`](configuration.md) for the full table):

- `OPENSANDBOX_BASE_URL` — URL of the `opensandbox` service (required)
- `OPENSANDBOX_API_KEY` — required API key shared with the server
- `OPENSANDBOX_IMAGE` — the pinned guest image (`open-agents-opensandbox-guest:1.0.0`)
- `OPENSANDBOX_CPU_LIMIT`, `OPENSANDBOX_MEMORY_LIMIT` — per-sandbox resource caps

Sandboxes are tracked in `AgentSandbox`; the reconcile worker syncs provider
state, pauses sandboxes according to each stored `autoStopInterval`, and clears
pointers for missing sandboxes. Sandboxes are created with `timeoutSeconds: null`
because OpenSandbox TTL expiry is destructive; idle lifecycle uses pause/resume.

**Egress.** The server uses `dns+nft`, disables IPv6, and launches the local
`open-agents-opensandbox-egress:1.1.4-hardened` image. Its immutable
`deny.always` blocks private, carrier-grade NAT, link-local/metadata, multicast,
and reserved IPv4 ranges before per-agent FQDN/wildcard rules are evaluated.
OpenSandbox's per-sandbox API does not support IP/CIDR allow targets; publishing
or running such a legacy policy fails with an actionable error instead of
silently weakening enforcement.

### Upgrading from the legacy hosted runtime

Existing installs migrating from the previous hosted runtime must take these steps.

1. **Export files and delete lingering remote sandboxes first.** Remote resources
   cannot be reached after the old provider credential is removed. Before
   upgrading, export workspace-only files, then stop/delete remaining sandboxes
   in the former provider's dashboard.
2. **Run the forward-only migration.** The `20260720120000_opensandbox_migration`
   Prisma migration runs on container start. It clears current chat/email/workflow
   session pointers, retires legacy sandbox rows without deleting their audit
   metadata, clears provider-specific attachment handles, and removes the obsolete
   encrypted credential. Historical `AgentVersion`, `WorkflowVersion`, `AgentRun`,
   and event payloads are never rewritten. Instead, the migration publishes cloned
   OpenSandbox successor versions, remaps current agent/workflow pointers and their
   frozen subagent/step references, and provisions fresh workspaces on first use.
   The migration is forward-only; export workspace-only files before deploying.
3. **Verify the cutover report and retire old credentials.** The migration deletes
   the encrypted legacy runtime secret from this deployment; revoke it with the
   former provider after remote cleanup is complete.

## Persistent data

Persist in production:

1. **Postgres** — all application state, jobs, and run events
2. **`apps/api/data/skills/`** — skill bundle zips (mount a volume at this path)
3. **`opensandbox_data`** — OpenSandbox SQLite control-plane/snapshot metadata

Without the skills volume, uploaded bundles are lost on container recreate and
OpenSandbox sandboxes cannot rematerialize pinned skill versions.

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
