# Local development

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Default ports are API `:3000` and Vite `:5173`. Visit `http://localhost:5173`, complete setup, and add at least one model-provider key. The sandbox runtime is configured through the `OPENSANDBOX_*` env vars (see [`configuration.md`](configuration.md)), not the setup wizard.

Postgres is required for Prisma, pg-boss, and LISTEN/NOTIFY. In Cursor Cloud, use the instructions in `AGENTS.md` to start the local Postgres cluster and apply migrations.

The `serveStatic` warning about `../web/dist` missing is expected in dev mode because Vite serves the SPA.

## Email testing

Expose the API if Mailgun needs to reach your machine, then point the catch-all route at `/mailgun/inbound`. Outbound email uses the Mailgun service secrets configured in Settings.

## Sandbox testing

Sandboxes run in the self-hosted OpenSandbox + Kata service. Verify `OPENSANDBOX_BASE_URL` points at a reachable OpenSandbox Server, publish an agent, and start a chat run. Run events and sandbox lifecycle events appear in the trace view.
