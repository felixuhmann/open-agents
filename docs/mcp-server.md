# Control-plane MCP server

The platform exposes a **Streamable HTTP** MCP server at `/mcp` that lets external agents (Claude Desktop, Cursor, custom MCP clients) perform the same operations as the web UI.

## Design: zero drift from the REST API

The MCP server does **not** re-implement business logic. Each MCP tool maps to one REST endpoint and forwards the call into the same Hono app the SPA uses (`app.request(...)`). Auth guards, Zod validation, Prisma writes, and job enqueueing all run through existing route handlers.

Tool `inputSchema` values are derived from the same Zod types as the REST API (`@open-agents/types` and route handlers). Models see per-operation tools (for example `agents_create`, `conversations_send_message`) with full JSON Schema for arguments — not a generic HTTP proxy.

## Authentication

MCP clients authenticate in one of two ways:

### OAuth connector (recommended)

Claude Desktop and other OAuth-native MCP clients use the standard MCP OAuth discovery flow:

1. Connect to `{PUBLIC_BASE_URL}/mcp`
2. On 401, read `WWW-Authenticate` → `/.well-known/oauth-protected-resource`
3. Discover the authorization server at `/.well-known/oauth-authorization-server`
4. Complete OAuth 2.1 authorization code + PKCE in the browser
5. Call `/mcp` with the issued `Authorization: Bearer <access_token>`

**Setup:** open **Settings → MCP connection** in the web UI (`/settings/mcp-connection`) and copy the MCP URL into Claude Desktop's OAuth connector UI. No manual token or config file is required.

OAuth is provided by better-auth's MCP plugin (`apps/api/src/auth/index.ts`). Root-level discovery endpoints are mounted at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

The authorization server itself lives under `/api/auth` (endpoints such as `/api/auth/mcp/authorize`, `/api/auth/mcp/token`, `/api/auth/mcp/register`).

### Bearer session token (advanced)

For clients that support manual Streamable HTTP configuration (for example Cursor), you can still generate a long-lived better-auth **session token**:

```
Authorization: Bearer <session_token>
```

On **Settings → MCP connection**, expand **Advanced: bearer token**, click **Generate auth token**, and paste the token into your client config.

Alternatively, sign in through the web UI or via the auth API:

```bash
curl -s -X POST "$PUBLIC_BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'
```

The response body includes a `token` field (and the `set-auth-token` response header). Use that value as the Bearer token.

Tokens expire with the session (default 7 days). Sign in again to refresh.

Role-based access is enforced exactly as in the SPA: admins can manage users/secrets, contributors can create agents, members see only agents they have access to. The `profile_get` and `profile_update` MCP tools expose the signed-in user's optional profile fields, and `agents_update` accepts `profileAccessEnabled` so MCP clients can configure requester-profile access before publishing an agent.

## Claude Desktop connector

### OAuth (recommended)

1. Open Claude Desktop → Settings → Connectors
2. Add a custom MCP / OAuth connector
3. Paste your deployment MCP URL, e.g. `https://your-deployment.example.com/mcp`
4. Sign in through the browser when prompted and approve consent if shown

Claude discovers OAuth metadata automatically; you do not edit `claude_desktop_config.json`.

### Manual bearer config (legacy)

For clients that still accept static headers in config JSON:

```json
{
  "mcpServers": {
    "open-agents": {
      "url": "https://your-deployment.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SESSION_TOKEN"
      }
    }
  }
}
```

For local development with the API on port 3000:

```json
{
  "mcpServers": {
    "open-agents": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SESSION_TOKEN"
      }
    }
  }
}
```

## Example: create an agent via MCP

Call the typed tool `agents_create` (the client receives JSON Schema for all fields):

```json
{
  "slug": "research-bot",
  "displayName": "Research Bot",
  "category": "Research",
  "systemPrompt": "You are a helpful research assistant."
}
```

Then publish with `agents_publish`:

```json
{
  "slug": "research-bot"
}
```

To change category later, call `agents_update` with `category` (or `null` to clear it). To allow an agent to receive the requester profile at runtime, call `agents_update` with `profileAccessEnabled: true` and then `agents_publish`. To attach tools, skills, or MCP servers, use `agents_update` with `toolBindings`, `skillBindings`, and `mcpServerIds` (see the tool schema in your MCP client).

## Adding a new REST route

When you add a REST handler under `/api/*`:

1. Add or extend Zod input types in `@open-agents/types` when the body/query is shared.
2. Register a matching tool in `apps/api/src/mcp/controlPlane/tools/` via `defineControlPlaneTool()`.
3. Append it to the appropriate module export consumed by `tools/index.ts`.

The proxy (`apiProxy.ts`) needs no changes for new `/api/*` paths.

## Limitations

- **Multipart uploads** (agent avatars, chat attachments, skill bundles, branding images) have no MCP tools. Use the web UI or direct HTTP with `multipart/form-data`.
- **SSE streams** (`runs_events`, `workflow_runs_events`) return raw `text/event-stream` bodies. For chat history prefer `conversations_get`.
- **Binary downloads** (`runs_download_attachment`) return raw bytes, not JSON.
- **Webhooks** (`/mailgun/inbound`) and the MCP endpoint itself are blocked from the proxy.
- **Setup wizard** (`POST /api/setup`) is only available before the first admin exists.

## Implementation files

| File                                           | Role                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `apps/api/src/routes/mcp.ts`                   | Hono route, auth gate, Streamable HTTP transport    |
| `apps/api/src/routes/wellKnown.ts`             | Root OAuth discovery for MCP clients                |
| `apps/api/src/auth/mcpAuth.ts`                 | OAuth + bearer session resolution for `/mcp`        |
| `apps/api/src/mcp/controlPlane/server.ts`      | MCP server factory                                  |
| `apps/api/src/mcp/controlPlane/defineTool.ts`  | Tool registration + REST proxy helper               |
| `apps/api/src/mcp/controlPlane/tools/`         | Per-operation tool definitions                      |
| `apps/api/src/mcp/controlPlane/apiProxy.ts`    | Internal `app.request` proxy                        |
| `apps/api/src/auth/index.ts`                   | `bearer()` + `mcp()` plugins                        |
| `apps/web/src/pages/OAuthConsentPage.tsx`      | OAuth consent UI during connector setup             |
| `apps/api/src/routes/api/controlPlaneSkill.ts` | Public skill download + info routes                 |
| `apps/api/src/services/controlPlaneSkill.ts`   | Compiles `docs/skills/…` into a `.skill` at runtime |

## Downloading the control-plane skill

The agent skill that teaches a client how to drive this MCP server lives in the
repo at `docs/skills/open-agents-control-plane/` (`SKILL.md` + `references/`).
Rather than committing a pre-built bundle that drifts, the API **compiles that
folder into a `.skill` bundle at request time**:

- `GET /api/skills/control-plane/bundle.skill` — **public, unauthenticated**.
  Streams a freshly-zipped `.skill` (cached in-process, served with a strong
  `ETag`). The bundle is documentation only, so it needs no auth.
- `GET /api/skills/control-plane` — public JSON with the download URL, the
  suggested install path, and a one-line install command.

The `apps/api` build copies the skill folder into `dist/skills/` (mirroring
`emails/static`), since `docs/` is stripped from the production image; the
service falls back to the repo `docs/` tree in dev.

MCP clients discover this via the **`skill_download_link`** tool, which returns
the JSON above. The intended flow preserves progressive disclosure: the tool
hands back a _link_, the agent fetches and unzips it into its skills directory
(`.claude/skills/open-agents-control-plane/`), and from then on only the
`SKILL.md` frontmatter sits in context — references are read on demand. Nothing
bulky is ever inlined into the tool result. Re-running the download always
reflects the current docs for this deployment. The output is also a valid
Skills Library bundle, so it can be re-uploaded via **Skills** if desired.

## Distinction from agent-runtime MCP

This control-plane MCP server is separate from:

- **Platform tools** (`memory_*`, etc.) — run in-process during agent runs
- **Third-party MCP servers** — external servers attached per agent via the MCP library

The control-plane server manages the deployment itself (agents, conversations, settings), not sandbox execution.
