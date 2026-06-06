# TODOs

This file tracks follow-up product and platform work.

## Near-term

- Expand Daytona sandbox lifecycle controls in the Settings UI.
- Add richer smoke tests around chat runs, file mounting, and `attach_run_file`.
- Add more platform tools beyond `memory`.
- Improve external MCP server validation and connection diagnostics.

## Roadmap

- **Scheduled tasks** — run agents or workflows on a regular interval (cron-style scheduling).
- **Workflow branching and permission gates** — branch inside a workflow, pause for human approval or external input, and resume from where execution stopped.
- **Unified platform API** — a single API key that routes model usage, email sending, and other platform capabilities automatically (no per-service credential wiring).
- **Managed hosting** — programmatically spin up new deployment instances and handle software management (updates, migrations, ops) on behalf of customers.
