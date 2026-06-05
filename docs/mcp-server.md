# Control-plane MCP server

The platform exposes a **Streamable HTTP** MCP server at `/mcp` that lets external agents (Claude Desktop, Cursor, custom MCP clients) perform the same operations as the web UI.

## Design: zero drift from the REST API

The MCP server does **not** re-implement business logic. Its primary tool, `api_request`, forwards calls into the same Hono app the SPA uses (`app.request(...)`). Auth guards, Zod validation, Prisma writes, and job enqueueing all run through existing route handlers.

| Tool          | Purpose                                                      |
| ------------- | ------------------------------------------------------------ |
| `api_request` | Call any allowed REST endpoint (method, path, query, body)   |
| `api_catalog` | Discover available endpoints (maintained in `apiCatalog.ts`) |

When you add a new REST route, add a catalog row in `apps/api/src/mcp/controlPlane/apiCatalog.ts` so MCP clients can discover it. The proxy itself needs no code changes — new `/api/*` routes work immediately.

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

Role-based access is enforced exactly as in the SPA: admins can manage users/secrets, contributors can create agents, members see only agents they have access to.

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

Use the `api_request` tool (or ask Claude to do it):

```json
{
  "method": "POST",
  "path": "/api/agents",
  "body": {
    "slug": "research-bot",
    "displayName": "Research Bot",
    "systemPrompt": "You are a helpful research assistant.",
    "modelProvider": "anthropic",
    "modelId": "claude-sonnet-4-20250514",
    "webEnabled": true,
    "emailEnabled": false
  }
}
```

Then publish:

```json
{
  "method": "POST",
  "path": "/api/agents/research-bot/publish"
}
```

## Limitations

- **Multipart uploads** (agent avatars, chat attachments, skill bundles) are not supported through `api_request`. Use the web UI or direct HTTP with `multipart/form-data`.
- **SSE streams** (`/api/runs/:id/events`) return the raw stream; for chat history prefer `GET /api/conversations/:id`.
- **Webhooks** (`/mailgun/inbound`) and the MCP endpoint itself are blocked from the proxy.
- **Setup wizard** (`POST /api/setup`) is only available before the first admin exists.

## Implementation files

| File                                          | Role                                             |
| --------------------------------------------- | ------------------------------------------------ |
| `apps/api/src/routes/mcp.ts`                  | Hono route, auth gate, Streamable HTTP transport |
| `apps/api/src/routes/wellKnown.ts`            | Root OAuth discovery for MCP clients             |
| `apps/api/src/auth/mcpAuth.ts`                | OAuth + bearer session resolution for `/mcp`     |
| `apps/api/src/mcp/controlPlane/server.ts`     | MCP tool registration                            |
| `apps/api/src/mcp/controlPlane/apiProxy.ts`   | Internal `app.request` proxy                     |
| `apps/api/src/mcp/controlPlane/apiCatalog.ts` | Endpoint discovery manifest                      |
| `apps/api/src/auth/index.ts`                  | `bearer()` + `mcp()` plugins                     |
| `apps/web/src/pages/OAuthConsentPage.tsx`     | OAuth consent UI during connector setup          |

## Distinction from agent-runtime MCP

This control-plane MCP server is separate from:

- **Platform tools** (`memory_*`, etc.) — run in-process during agent runs
- **Third-party MCP servers** — external servers attached per agent via the MCP library

The control-plane server manages the deployment itself (agents, conversations, settings), not sandbox execution.
