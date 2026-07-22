# Local development

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Default ports are API `:3000` and Vite `:5173`. Visit `http://localhost:5173`, complete setup, and add at least one model-provider key. Setup also asks which sandbox provider to use: Daytona (needs an API key) or the self-hosted broker (needs `SANDBOX_BROKER_URL` in the environment).

Postgres is required for Prisma, pg-boss, and LISTEN/NOTIFY. In Cursor Cloud, use the instructions in `AGENTS.md` to start the local Postgres cluster and apply migrations.

The `serveStatic` warning about `../web/dist` missing is expected in dev mode because Vite serves the SPA.

## Email testing

Expose the API if Mailgun needs to reach your machine, then point the catch-all route at `/mailgun/inbound`. Outbound email uses the Mailgun service secrets configured in Settings.

## Sandbox testing

Daytona sandboxes are remote: verify `daytona_api_key` is configured, publish an agent, and start a chat run. Run events and sandbox lifecycle events appear in the trace view.

For the self-hosted broker, run one locally (see the broker repository's `compose.example.yaml`) and point the API at it:

```bash
SANDBOX_BROKER_URL=http://127.0.0.1:8080 SANDBOX_BROKER_TOKEN=... pnpm dev
```

The broker adapter's integration suite exercises a real broker and skips itself when those variables are absent, so `pnpm --filter @open-agents/api test` stays hermetic by default:

```bash
SANDBOX_BROKER_URL=http://127.0.0.1:8080 SANDBOX_BROKER_TOKEN=... \
  pnpm --filter @open-agents/api test
```
