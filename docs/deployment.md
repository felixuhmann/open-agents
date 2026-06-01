# Deployment

Deploy the API and SPA together behind a single public origin. The Hono API serves the built SPA in production; local development uses Vite on a separate port.

## Required bootstrap env

- `DATABASE_URL`
- `SECRET_ENCRYPTION_KEY`
- `BETTER_AUTH_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `PUBLIC_BASE_URL`
- `WEB_BASE_URL`

Service credentials are stored in the encrypted `Secret` table, not env. Configure them through the setup wizard and Settings -> Secrets:

- `daytona_api_key` for the runtime backend.
- `anthropic_api_key`, `openai_api_key`, or `openrouter_api_key` for model providers.
- `mailgun_api_key`, `mailgun_domain`, and `mailgun_signing_key` for email.

## Mailgun

Configure a single catch-all inbound route to `POST /mailgun/inbound`. The webhook resolves the target agent from the recipient local part.

## Daytona

Set `daytona_api_key` before running agents. Sandboxes are tracked in `AgentSandbox`; the reconcile worker syncs provider state, stops stale sandboxes, and clears pointers for missing sandboxes.

## Persistent data

Persist Postgres and `apps/api/data/skills/` in production. Skill bundles must survive restarts so Daytona sandboxes can materialize pinned versions.
