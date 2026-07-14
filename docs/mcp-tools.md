# Tools

Every capability an agent can call is a row in the unified `Tool` catalog, regardless of who runs the code. The discriminator is `Tool.runtime`:

| Runtime    | Where the code lives                                    | Stored as                                                                                         | Examples                                                                    |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `managed`  | Daytona sandbox tools exposed by `DaytonaAgentBackend`. | `AgentToolBinding` -> `Tool` row with `runtime = "managed"`.                                      | `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`. |
| `platform` | This backend, invoked host-side by the Pi loop.         | `AgentToolBinding` -> `Tool` row with `runtime = "platform"`. `Tool.key` = `PlatformHandler.key`. | The shipped `memory` handler; future `drive`, `webhook`, ...                |

External MCP servers live in the `McpServer` library and attach to agents through `AgentMcpBinding`. They are per-agent endpoints, not catalog rows. Daytona runs connect to them from the orchestrator, discover tools with the MCP SDK client, and expose those tools to Pi as native `AgentTool`s.

## Authoring a platform tool

Platform tools are handler bundles, not individual exports. A handler exposes one or more tools that are conceptually a single feature, such as the `memory` handler exposing `memory_create`, `memory_read`, and related operations.

### 1. Write the handler

Add a file under `apps/api/src/mcp/platform/<key>.ts`:

```ts
import { z } from "zod";
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
    // ctx.agentId, ctx.bindingId, ctx.secrets are provided by the host
    return { ok: true };
  },
});

export const driveHandler: PlatformHandler = {
  key: "drive",
  name: "Team drive",
  description: "Read/write files in the shared team drive.",
  tools: [create],
};
```

### 2. Register it

Append the handler to `PLATFORM_HANDLERS` in `apps/api/src/mcp/platform/index.ts`.

### 3. The catalog row appears automatically

`services/seedToolCatalog.ts` runs at boot and upserts a `Tool` row for every entry in `PLATFORM_HANDLERS`, alongside the Daytona-managed sandbox tool rows. The next time the SPA queries `/api/tools`, the new tool shows up; admins tick it on the edit page to bind it.

There is no manual SQL or seed step. Just register the handler and restart.

## Control-plane MCP server

The platform also **hosts** an MCP server at `/mcp` for external clients (Claude Desktop, Cursor, etc.) to manage the deployment — create agents, run chats, configure settings. See [`mcp-server.md`](mcp-server.md).

Unlike platform tools and third-party MCP servers (used during agent runs), the control-plane server exposes one typed MCP tool per REST operation (for example `agents_create`) and proxies into the same Hono REST handlers, so there is no duplicate business logic.

## Pi / Daytona execution

Implementation lives under `apps/api/src/mcp/`:

- `piTools.ts` builds Pi `AgentTool` definitions for platform bindings and third-party MCP servers.
- `invokePlatformTool.ts` runs code-shipped handlers with decrypted per-binding secrets.
- `thirdPartyClient.ts` connects to external MCP servers from the orchestrator and formats tool results.

Third-party MCP tools are exposed to the model as `<server-slug>_<tool-name>` (for example `firecrawl_firecrawl_scrape`). Names must match OpenAI’s `^[a-zA-Z0-9_-]+$` pattern, so the orchestrator slugifies the server label and sanitizes the MCP tool name before registering them with Pi.

Platform tool secrets never enter the Daytona sandbox. External MCP bearer and OAuth tokens are decrypted on the API host and used only by the orchestrator-side MCP client. OAuth refresh tokens, client secrets, and access tokens are never serialized into agent prompts or version snapshots.

## MCP library operator UX

The SPA **MCP** library (`/library/mcp`) is where admins register deployment-wide third-party MCP servers. Each card shows a health badge after a probe; admins can **Check all** or test individual servers.

| Action                                       | API                               | Notes                                                                                                                                           |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Test unsaved URL + bearer (create/edit form) | `POST /api/mcp-servers/probe`     | Body: `{ serverUrl, bearer? }`. Admin only.                                                                                                     |
| Test stored server                           | `POST /api/mcp-servers/:id/probe` | Uses the encrypted stored bearer unless `bearer` is sent in the body to try a new token before save.                                            |
| Import connector manifest                    | (client-side)                     | Paste JSON matching `McpConnectorManifest` in the create dialog; fills name, label, description, and URL. Bearer tokens are never in manifests. |

Probe responses (`McpProbeResult`) include connection status (`connected`, `auth_failure`, `unreachable`, `timeout`, `protocol_error`, `error`), latency, auth diagnostics (HTTP status, whether a bearer was sent), and a tool discovery preview (name, description, input schema per tool).

Implementation: `apps/api/src/mcp/probeMcpServer.ts` connects with the same Streamable HTTP transport as runtime (`thirdPartyClient.ts`), lists tools, classifies failures, applies the configured server-wide tool allowlist, and always closes the client.

### Google Drive with refreshable OAuth

Use **Add Google Drive** to create a least-privilege connection to Google's official hosted endpoint:

```text
https://drivemcp.googleapis.com/mcp/v1
```

The preset requests `openid`, `email`, and `drive.readonly`. It exposes only the official read/search tools; `create_file` and `copy_file` are excluded. An empty allowlist on an existing generic MCP entry keeps the historical behavior of exposing all discovered tools.

Before creating the connection:

1. Create a Google Cloud **Web application** OAuth client.
2. Enable `drive.googleapis.com` and `drivemcp.googleapis.com` in that project.
3. Grant the calling identity `roles/mcp.toolUser` where required by Google Cloud MCP.
4. Register the exact callback displayed by the UI:
   `https://<deployment>/api/mcp-servers/oauth/callback`.
5. Enter the OAuth client ID and secret, save the server, then click **Connect Google**.

The backend signs OAuth `state`, derives a PKCE verifier, exchanges the authorization code server-side, encrypts the client secret and token set with `SECRET_ENCRYPTION_KEY`, and refreshes short-lived access tokens before probes and agent runs. Concurrent refreshes are coalesced within the API process. `invalid_grant` or revoked credentials surface as a failed probe and require **Reconnect Google**.

For deployment-wide agent access, authorize a dedicated Workspace account that can see only the intended Shared Drive. Do not connect a personal or Workspace-admin account: `drive.readonly` covers every file visible to that identity and is not a folder-level boundary. Avoid domain-wide delegation unless cross-user impersonation is an explicit requirement.

Add `https://www.googleapis.com/auth/drive.file` and the write tools only when agents genuinely need to create files. Drive content remains untrusted model input; combine least-privilege Google membership, the MCP tool allowlist, and human confirmation for consequential writes.

OAuth lifecycle endpoints are admin-only except for the signed Google callback:

| Action                   | API                                          |
| ------------------------ | -------------------------------------------- |
| Read configured callback | `GET /api/mcp-servers/oauth/config`          |
| Start authorization      | `POST /api/mcp-servers/:id/oauth/start`      |
| Google callback          | `GET /api/mcp-servers/oauth/callback`        |
| Disconnect tokens        | `POST /api/mcp-servers/:id/oauth/disconnect` |

### Connector manifests

Deployment-specific MCP connector repos can export a small JSON manifest for fast registration:

```json
{
  "manifestVersion": 1,
  "name": "acme-crm",
  "label": "Acme CRM",
  "description": "Read/write customer records via the on-prem connector.",
  "serverUrl": "https://mcp.internal.example.com/mcp"
}
```

`manifestVersion` may be omitted (defaults to `1`). Operators paste the manifest in the UI, then add the bearer token separately.

`RunEvent` payloads for `tool.use` / `tool.result` include `callId`, `args`, and truncated `result` text where available for debugging.

## The shipped catalog

| Runtime    | `key`        | Tools                                                                                                 | Notes                                                          |
| ---------- | ------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `managed`  | `bash`       | `bash`                                                                                                | Runs inside the Daytona sandbox.                               |
| `managed`  | `read`       | `read`                                                                                                | Reads files from the sandbox workspace.                        |
| `managed`  | `write`      | `write`                                                                                               | Writes files in the sandbox workspace.                         |
| `managed`  | `edit`       | `edit`                                                                                                | Edits files in the sandbox workspace.                          |
| `managed`  | `glob`       | `glob`                                                                                                | File pattern matching in the sandbox workspace.                |
| `managed`  | `grep`       | `grep`                                                                                                | Regex search in the sandbox workspace.                         |
| `managed`  | `web_fetch`  | `web_fetch`                                                                                           | Fetches URL content from the sandbox.                          |
| `managed`  | `web_search` | `web_search`                                                                                          | Placeholder row; use curl or a third-party MCP search server.  |
| `platform` | `memory`     | `memory_collections`, `memory_create`, `memory_read`, `memory_list`, `memory_update`, `memory_delete` | Generic JSON-doc collection store scoped to the calling agent. |

## Common patterns

### "Get everything" tool at the start of a run

If your handler exposes a fan-out of small reads, also expose a single `get_config` or similar tool that returns the whole shape in one call. The agent's prompt can then run a script over the result without many chatty tool round-trips.

### Secret validation

Fail fast in the handler when a required secret is missing:

```ts
const token = ctx.secrets.token;
if (!token) throw new Error("Missing token for this binding");
```

That error is visible to the agent as a tool error and to operators in `RunEvent`.
