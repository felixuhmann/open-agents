# Tools

Every capability an agent can call is a row in the unified `Tool` catalog, regardless of who runs the code. The discriminator is `Tool.runtime`:

| Runtime    | Where the code lives                                    | Stored as                                                                                         | Examples                                                                    |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `managed`  | Daytona sandbox tools exposed by `DaytonaAgentBackend`. | `AgentToolBinding` -> `Tool` row with `runtime = "managed"`.                                      | `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`. |
| `platform` | This backend, invoked host-side by the Pi loop.         | `AgentToolBinding` -> `Tool` row with `runtime = "platform"`. `Tool.key` = `PlatformHandler.key`. | The shipped `memory` and scoped `google_drive` handlers.                    |

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

Platform tool secrets never enter the Daytona sandbox. External MCP bearer tokens are decrypted on the API host and used only by the orchestrator-side MCP client.

## MCP library operator UX

The SPA **MCP** library (`/library/mcp`) is where admins register deployment-wide third-party MCP servers. Each card shows a health badge after a probe; admins can **Check all** or test individual servers.

| Action                                       | API                               | Notes                                                                                                                                           |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Test unsaved URL + bearer (create/edit form) | `POST /api/mcp-servers/probe`     | Body: `{ serverUrl, bearer? }`. Admin only.                                                                                                     |
| Test stored server                           | `POST /api/mcp-servers/:id/probe` | Uses the encrypted stored bearer unless `bearer` is sent in the body to try a new token before save.                                            |
| Import connector manifest                    | (client-side)                     | Paste JSON matching `McpConnectorManifest` in the create dialog; fills name, label, description, and URL. Bearer tokens are never in manifests. |

Probe responses (`McpProbeResult`) include connection status (`connected`, `auth_failure`, `unreachable`, `timeout`, `protocol_error`, `error`), latency, auth diagnostics (HTTP status, whether a bearer was sent), and a tool discovery preview (name, description, input schema per tool).

Implementation: `apps/api/src/mcp/probeMcpServer.ts` connects with the same Streamable HTTP transport as runtime (`thirdPartyClient.ts`), lists tools, classifies failures, and always closes the client.

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

| Runtime    | `key`          | Tools                                                                                                                                                                             | Notes                                                                                                            |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `managed`  | `bash`         | `bash`                                                                                                                                                                            | Runs inside the Daytona sandbox.                                                                                 |
| `managed`  | `read`         | `read`                                                                                                                                                                            | Reads files from the sandbox workspace.                                                                          |
| `managed`  | `write`        | `write`                                                                                                                                                                           | Writes files in the sandbox workspace.                                                                           |
| `managed`  | `edit`         | `edit`                                                                                                                                                                            | Edits files in the sandbox workspace.                                                                            |
| `managed`  | `glob`         | `glob`                                                                                                                                                                            | File pattern matching in the sandbox workspace.                                                                  |
| `managed`  | `grep`         | `grep`                                                                                                                                                                            | Regex search in the sandbox workspace.                                                                           |
| `managed`  | `web_fetch`    | `web_fetch`                                                                                                                                                                       | Fetches URL content from the sandbox.                                                                            |
| `managed`  | `web_search`   | `web_search`                                                                                                                                                                      | Placeholder row; use curl or a third-party MCP search server.                                                    |
| `platform` | `memory`       | `memory_collections`, `memory_create`, `memory_read`, `memory_list`, `memory_update`, `memory_delete`                                                                             | Generic JSON-doc collection store scoped to the calling agent.                                                   |
| `platform` | `google_drive` | `google_drive_list`, `google_drive_search`, `google_drive_read`, `google_drive_create_file`, `google_drive_create_folder`, `google_drive_upload_file`, `google_drive_update_file` | Service-account access restricted to one configured Shared Drive folder tree. No delete, move, or sharing tools. |

## Google Drive folder setup

The shipped Google Drive integration calls the regular Drive API from the API host. It does not use Google's hosted MCP preview or an end-user OAuth consent screen, so it does not depend on Google OAuth app verification.

1. In the deployment's Google Cloud project, enable the **Google Drive API** and create a service account with a JSON key.
2. In Google Drive, grant that service account access to the company Shared Drive or to the dedicated AI folder. Prefer a dedicated Shared Drive or a limited-access folder so Google's own ACL is as narrow as possible.
3. In **Settings -> Service secrets**, save the complete JSON key as `google_drive_service_account_json`.
4. On the agent edit page, enable **Google Drive folder** and set:
   - **Shared Drive ID**: the Shared Drive identifier.
   - **AI-accessible root folder ID**: the folder identifier at the boundary of the agent's access.
5. Save and publish a new agent version.

Every list, search, read, and write validates the target item's ancestry before proceeding. Searches are first scoped to the Shared Drive and then filtered to descendants of the configured root. Shortcuts are not followed, and the handler exposes no delete, move, permission, or sharing operation. The service-account credential is encrypted in the deployment database and never enters Daytona.

The write tools create folders and regular UTF-8 files, replace the contents of existing regular files, and upload binary files from the active Daytona sandbox. Binary uploads preserve the original bytes and file type; they do not convert Office documents into Google Docs, Sheets, or Slides. Google-native files can be read through export, but modifying their content is intentionally outside this implementation.

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
