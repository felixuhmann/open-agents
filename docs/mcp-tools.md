# Tools

Every capability an agent can call is a row in the unified `Tool`
catalog, regardless of who runs the code. The discriminator is
`Tool.runtime`:

| Runtime    | Where the code lives                                             | Stored as                                                                                        | Examples                                                                                                         |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `managed`  | The agent backend's own compute (Anthropic's session container). | `AgentToolBinding` → `Tool` row with `runtime = "managed"`.                                      | Members of `agent_toolset_20260401`: `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`. |
| `platform` | This backend, served from `/mcp/<slug>`.                         | `AgentToolBinding` → `Tool` row with `runtime = "platform"`. `Tool.key` = `PlatformHandler.key`. | The shipped `memory` handler; future `drive`, `webhook`, …                                                       |

External (user-supplied) MCP servers stay separate as `AgentThirdPartyMcp`
— they are per-agent endpoints, not catalog entries.

The Anthropic-specific request shape (`agent_toolset_20260401` block,
`mcp_toolset` entries, `mcp_servers`) is built **only** at publish time
in
[`apps/api/src/anthropic/provisioning.ts`](../apps/api/src/anthropic/provisioning.ts).
Application code outside that file should not assume any backend-
specific layout.

This document covers **platform tools** — the only ones whose code lives
in this repo. Managed tools are seeded as catalog rows by
`seedToolCatalog()` so admins can pick them in the UI, but there is no
handler in this codebase; they execute on Anthropic's container.

## Why MCP at all (for platform tools)

The Managed Agents sandbox is ephemeral — it has compute, a filesystem,
and outbound HTTP, but no persistent storage of its own. State that
needs to outlive a session lives in our Postgres and is reached over
MCP. Stateless callbacks; per-call DB round-trip; single bearer token
per agent.

## Authoring a platform tool

Platform tools are **handler bundles**, not individual exports. A
handler exposes one or more tools that are conceptually a single feature
(e.g. the `memory` handler exposes `memory_create`, `memory_read`, etc.).

### 1. Write the handler

Add a file under `apps/api/src/mcp/platform/<key>.ts`:

```ts
import { z } from "zod";
import { prisma } from "../../db.js";
import { defineTool, type PlatformHandler } from "../types.js";

const create = defineTool({
  name: "drive_create",
  description: "Upload a small file to the team drive.",
  input: z.object({
    name: z.string().min(1),
    content: z.string(),
  }),
  handler: async (input, ctx) => {
    // input is parsed and typed
    // ctx.agentId    — Agent.id of the caller
    // ctx.bindingId  — AgentToolBinding.id (use to look up secrets)
    // ctx.secrets    — Record<string, string> of decrypted tool secrets
    return { ok: true };
  },
});

const list = defineTool({
  /* … */
});

export const driveHandler: PlatformHandler = {
  key: "drive",
  name: "Team drive",
  description: "Read/write files in the shared team drive.",
  tools: [create, list],
};
```

### 2. Register it

Append the handler to the registry in
[`apps/api/src/mcp/platform/index.ts`](../apps/api/src/mcp/platform/index.ts):

```ts
import { driveHandler } from "./drive.js";

export const PLATFORM_HANDLERS: PlatformHandler[] = [
  memoryHandler,
  driveHandler, // ← here
];
```

### 3. The catalog row appears automatically

[`services/seedToolCatalog.ts`](../apps/api/src/services/seedToolCatalog.ts)
runs at boot and upserts a `Tool` row (with `runtime = "platform"`) for
every entry in `PLATFORM_HANDLERS`, alongside the managed rows for
`agent_toolset_20260401`. The next time the SPA queries `/api/tools`
the new tool shows up; admins tick it on the edit page to bind it.

There is no manual SQL or seed step. Just register the handler and
restart.

## Conventions

- **Tool `name`** is what the agent sees and what you'll grep for in
  logs (`run-agent: tool.use`). Snake_case, descriptive.
- **`description`** is the only context the agent has on _when_ to call
  the tool. Treat it as production prompt content; review it like
  prompt engineering.
- **Returned values** are JSON-serialized into a single `text` content
  block. Return plain objects; don't pre-stringify.
- **Throw on failure** — the wrapper turns the throw into an MCP
  `isError` response with the message. The agent sees a tool error and,
  depending on its prompt, may retry or escalate.
- **Per-binding secrets** live on `ctx.secrets`. The MCP route resolves
  them via `getToolSecrets(bindingId)` before calling your handler. Use
  this for OAuth tokens, API keys — anything per-binding.

## Pi / Daytona (orchestrator-side MCP)

`@earendil-works/pi-agent-core` does **not** ship native MCP support — the
Pi author recommends CLI wrappers (`mcporter`) or community extensions such
as [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) /
[`@0xkobold/pi-mcp`](https://github.com/0xKobold/pi-mcp) for interactive
coding agents. For this platform we take a different path that fits a
hosted multi-tenant orchestrator:

| Capability                             | Mechanism                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform tools (`memory`, …)           | In-process `invokePlatformTool()` on the API host — same handlers as the HTTP MCP server, secrets never enter the Daytona sandbox.                                           |
| Third-party MCP (`AgentThirdPartyMcp`) | MCP SDK `Client` + `StreamableHTTPClientTransport` on the orchestrator; tools discovered via `tools/list` and exposed as native Pi `AgentTool`s named `<label-slug>:<tool>`. |
| Anthropic Managed Agents (legacy)      | Unchanged: published `mcp_servers` + vault bearer; Anthropic's sandbox calls `POST /mcp/<slug>`.                                                                             |

Implementation lives under [`apps/api/src/mcp/`](../apps/api/src/mcp/)
(`piTools.ts`, `thirdPartyClient.ts`, `invokePlatformTool.ts`). The HTTP
route [`routes/mcp.ts`](../apps/api/src/routes/mcp.ts) remains for
Anthropic backward compatibility; Daytona runs do not loop back through
it for platform tools.

`RunEvent` payloads for `tool.use` / `tool.result` now include `callId`,
`args`, and truncated `result` text where available for debugging.

## What the platform does

[`apps/api/src/mcp/server.ts`](../apps/api/src/mcp/server.ts) builds the
per-agent handler:

1. The route in [`apps/api/src/routes/mcp.ts`](../apps/api/src/routes/mcp.ts)
   gates each request with a constant-time
   `Authorization: Bearer <MCP_AUTH_TOKEN>` check.
2. Then it resolves the `Agent` from the slug via `getAgentBySlug` (a
   small in-process `Map` cache fronting Postgres, invalidated on agent
   mutations).
3. `buildMcpHandler(agent)` walks the agent's `AgentToolBinding`s,
   skips any binding whose `Tool.runtime` is `managed` (those execute
   on Anthropic's side), looks up each platform handler by `Tool.key`,
   and registers every `defineTool(...)` descriptor on a fresh
   `McpServer`.
4. Each request also gets a fresh `WebStandardStreamableHTTPServerTransport`
   because the SDK's stateless transport is single-use. We rebuild the
   `McpServer` per request too, so binding changes propagate immediately
   without restart — the work is tiny.

## Authentication & secrets

- **Backend side**: `MCP_AUTH_TOKEN` (env). Required, min 16 chars,
  generate with `openssl rand -hex 32`. Constant-time compare in
  [`routes/mcp.ts`](../apps/api/src/routes/mcp.ts).
- **Anthropic side**: a `static_bearer` credential in the deployment
  vault, mapping each `/mcp/<slug>` URL to the same value. Provisioned
  automatically by [`anthropic/vault.ts`](../apps/api/src/anthropic/vault.ts)
  during **Publish** — admins never touch the vault directly. The
  deployment vault is also created on demand the first time anyone
  publishes a platform-bound agent and stored under
  `anthropic_vault_id` in the `Secret` table.

Rotating `MCP_AUTH_TOKEN` is a two-step lockstep change:

1. Update the env value and roll the backend.
2. Re-publish every agent that binds a platform tool. The publish flow
   PATCHes each existing `static_bearer` credential to the new token, so
   "click Publish on every agent" is the rotation procedure. There's no
   multi-token grace period today.

## The shipped catalog

| Runtime    | `key`        | Tools                                                                                                 | Notes                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `managed`  | `bash`       | `bash`                                                                                                | Runs on Anthropic's container.                                                                                                                                                                                                                                                                                 |
| `managed`  | `read`       | `read`                                                                                                |                                                                                                                                                                                                                                                                                                                |
| `managed`  | `write`      | `write`                                                                                               |                                                                                                                                                                                                                                                                                                                |
| `managed`  | `edit`       | `edit`                                                                                                |                                                                                                                                                                                                                                                                                                                |
| `managed`  | `glob`       | `glob`                                                                                                |                                                                                                                                                                                                                                                                                                                |
| `managed`  | `grep`       | `grep`                                                                                                |                                                                                                                                                                                                                                                                                                                |
| `managed`  | `web_fetch`  | `web_fetch`                                                                                           |                                                                                                                                                                                                                                                                                                                |
| `managed`  | `web_search` | `web_search`                                                                                          |                                                                                                                                                                                                                                                                                                                |
| `platform` | `memory`     | `memory_collections`, `memory_create`, `memory_read`, `memory_list`, `memory_update`, `memory_delete` | Generic JSON-doc collection store, scoped to the calling agent. Collection names are free-form, so the agent should either be told the exact name in its prompt/skill or call `memory_collections` first to reuse an existing one (otherwise `guest_list` vs `guestlist` will silently read different stores). |

We expect the `platform` row count to grow. New v1.x ideas in flight:

- `drive` — read/write a per-deployment shared file store.
- `webhook` — declarative no-code outbound webhook tool.
- Per-collection memory schemas (v1.5) — let admins declare a Zod-style
  shape per collection and have the memory tool enforce it.

If Anthropic ships a new toolset version (e.g. `agent_toolset_20270401`),
extend `MANAGED_TOOLS` in
[`services/seedToolCatalog.ts`](../apps/api/src/services/seedToolCatalog.ts)
and `provisioning.ts` will publish whatever is in the catalog. Retired
toolset members should be flipped to `Tool.deprecated = true` so the UI
hides them but existing bindings keep working.

## Common patterns

### "Get everything" tool at the start of a run

If your handler exposes a fan-out of small reads, also expose a single
`get_config` (or similar) that returns the whole shape in one call. The
agent's prompt can then run a Python script over the result without N
chatty round-trips.

### Idempotent "add or skip" tools

When the agent re-runs a step, an idempotent tool returns
`{ added: N, skipped: M, results: [...] }` so the agent can reason
about what actually changed. The agent doesn't always know whether a
previous turn already wrote.

## Things that have surprised people

- **Returning bare strings.** The wrapper `JSON.stringify`s everything,
  so a handler that returns `"ok"` becomes the literal string `"ok"`
  with quotes. Return an object: `{ ok: true }`.

- **Long-running tool handlers block the SSE response.** Each tool call
  is a single round-trip; don't kick off background work and return.
  If you need async fan-out, model it explicitly (e.g. enqueue a
  pg-boss job and return a job id the agent can poll).

- **No per-tool auth.** A single bearer token gates the whole MCP
  surface for an agent. If you need a "dangerous" tool only in specific
  contexts, gate it inside the handler.

- **Memory is per-agent, not per-collection.** Two collections in the
  same agent share the same security boundary; two agents don't share
  memory at all. Don't model trust boundaries as collections.
