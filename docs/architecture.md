# Architecture

open-agents is a single-tenant agent platform with a Hono API, Vite SPA, Prisma/Postgres persistence, pg-boss workers, pluggable agent sandboxes, and a Pi model/tool loop.

```
Browser SPA ──▶ Hono /api/* ──▶ Postgres (Prisma)
      ▲              │
      │              └──▶ pg-boss queue ──▶ run-agent worker
      │                                      ├─ create/resume a provider sandbox
      │                                      ├─ mount uploaded resources
      │                                      ├─ run Pi model/tool loop
      │                                      └─ append RunEvent rows + NOTIFY
      └─ EventSource /api/runs/:id/events ◀── Postgres LISTEN/NOTIFY

Mailgun ──▶ POST /mailgun/inbound ──▶ enqueue run-agent ──▶ send-email worker
```

## Runtime

The runtime is split in two:

- One provider-neutral Pi agent runtime (`agent-backend/pi.ts`) owns the model/tool loop and consumes a `SandboxHandle`. It contains no provider SDK types.
- A low-level `SandboxProvider` (`sandbox-provider/types.ts`) owns sandbox mechanics: create, connect, exec, files, and lifecycle.

Two providers implement it. `sandbox-provider/daytona/` wraps `@daytona/sdk` using the encrypted `daytona_api_key` service secret. `sandbox-provider/broker/` talks to a self-hosted [sandbox broker](https://github.com/felixuhmann/sandbox-broker) over HTTP, configured from `SANDBOX_BROKER_URL` plus a token or token file in the environment.

One provider is active deployment-wide, stored in the `sandbox_provider` app setting. **A deployment with no such setting resolves to Daytona**, so existing installs are unaffected. Every `AgentSandbox` row and session id records the provider that created it, and lifecycle operations always dispatch through _that_ provider — switching the active provider never orphans history. See [docker/sandbox-broker/README.md](../docker/sandbox-broker/README.md) for the broker's threat model and network semantics.

Claude, OpenAI, and OpenRouter are model providers resolved by `services/piModel.ts`; they are not sandbox runtimes.

Published agents are local snapshots. `publishAgent()` stores an immutable `AgentVersion.payload` with the system prompt, model selection, tool bindings, skill bindings, external MCP servers, and sandbox policy. Runs pin the version they start with.

## Tools

`Tool.runtime` determines where a capability runs:

- `managed` tools run in the agent's sandbox, whichever provider backs it (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`).
- `platform` tools run on the API host through `mcp/platform/*` handlers.
- External MCP servers live in `McpServer` and attach through `AgentMcpBinding`; the orchestrator connects to them from `mcp/thirdPartyClient.ts`.

The Pi loop receives all selected capabilities as native Pi tools from `mcp/piTools.ts`.

## Durable chat and email

Web chat and email are separate surfaces. Each has its own conversation/thread table and session id. Attachments are stored in Postgres, uploaded to the backend file store, and mounted into the agent's sandbox. Agent-created files are returned with `attach_run_file` and stored as `AgentAttachment` rows.

A Pi `Agent` object is deliberately created for each application turn. It is an ephemeral runner, not the durable conversation. Before each turn the worker restores the latest successful `AgentRun.piContext`; after Pi becomes idle it checkpoints the replayable context, including assistant tool calls, tool results, and provider reasoning metadata. Chat/email jobs use conversation-scoped queue keys with at most one active turn per conversation so two turns cannot race the same checkpoint. See [Agent sessions and context](agent-sessions.md) for the lifecycle and retention contract.

## Data model highlights

- `Agent` — draft config, surfaces, ACL, sandbox policy, and `currentVersionId`.
- `AgentVersion` — immutable published runtime snapshot.
- `ChatConversation.sessionId` / `EmailThread.sessionId` — current sandbox session, encoded as `{provider}:{agentId}:{providerSandboxId}`. Legacy `daytona:*` ids keep parsing unchanged.
- `AgentSandbox` — provider, provider sandbox id, state, lifecycle policy, links to chat/email surfaces. The `provider` column is what lifecycle actions dispatch on.
- `RunEvent` — append-only event stream powering SSE replay and trace views.
- `SkillVersion.bundleStorageRef` — local zip bundle materialized into sandboxes at creation time.
