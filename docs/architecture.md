# Architecture

open-agents is a single-tenant agent platform with a Hono API, Vite SPA, Prisma/Postgres persistence, pg-boss workers, Daytona sandboxes, and a Pi model/tool loop.

```
Browser SPA ──▶ Hono /api/* ──▶ Postgres (Prisma)
      ▲              │
      │              └──▶ pg-boss queue ──▶ run-agent worker
      │                                      ├─ create/resume Daytona sandbox
      │                                      ├─ mount uploaded resources
      │                                      ├─ run Pi model/tool loop
      │                                      └─ append RunEvent rows + NOTIFY
      └─ EventSource /api/runs/:id/events ◀── Postgres LISTEN/NOTIFY

Mailgun ──▶ POST /mailgun/inbound ──▶ enqueue run-agent ──▶ send-email worker
```

## Runtime

Daytona is the only agent backend. `getAgentBackend()` constructs a `DaytonaAgentBackend` from the encrypted `daytona_api_key` service secret. Claude, OpenAI, and OpenRouter are model providers resolved by `services/piModel.ts`; they are not backend runtimes.

Published agents are local snapshots. `publishAgent()` stores an immutable `AgentVersion.payload` with the system prompt, model selection, tool bindings, skill bindings, external MCP servers, and sandbox policy. Runs pin the version they start with.

## Tools

`Tool.runtime` determines where a capability runs:

- `managed` tools run in the Daytona sandbox (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`).
- `platform` tools run on the API host through `mcp/platform/*` handlers.
- External MCP servers live in `McpServer` and attach through `AgentMcpBinding`; the orchestrator connects to them from `mcp/thirdPartyClient.ts`.

The Pi loop receives all selected capabilities as native Pi tools from `mcp/piTools.ts`.

## Durable chat and email

Web chat and email are separate surfaces. Each has its own conversation/thread table and session id. Attachments are stored in Postgres, uploaded to the backend file store, and mounted into the Daytona sandbox. Agent-created files are returned with `attach_run_file` and stored as `AgentAttachment` rows.

A Pi `Agent` object is deliberately created for each application turn. It is an ephemeral runner, not the durable conversation. Before each turn the worker restores the latest successful `AgentRun.piContext`; after Pi becomes idle it checkpoints the replayable context, including assistant tool calls, tool results, and provider reasoning metadata. Chat/email jobs use conversation-scoped queue keys with at most one active turn per conversation so two turns cannot race the same checkpoint. See [Agent sessions and context](agent-sessions.md) for the lifecycle and retention contract.

## Data model highlights

- `Agent` — draft config, surfaces, ACL, sandbox policy, and `currentVersionId`.
- `AgentVersion` — immutable published runtime snapshot.
- `ChatConversation.sessionId` / `EmailThread.sessionId` — current Daytona-backed session.
- `AgentSandbox` — provider sandbox id, state, lifecycle policy, links to chat/email surfaces.
- `RunEvent` — append-only event stream powering SSE replay and trace views.
- `SkillVersion.bundleStorageRef` — local zip bundle materialized into Daytona sandboxes.
