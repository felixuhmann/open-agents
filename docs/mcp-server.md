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

MCP clients authenticate with a **better-auth session token** via the Bearer plugin:

```
Authorization: Bearer <session_token>
```

### Getting a token

**Recommended:** open **Settings → MCP connection** in the web UI (`/settings/mcp-connection`), click **Generate auth token**, and copy the ready-made `claude_desktop_config.json` block.

Alternatively, sign in through the web UI or via the auth API:

```bash
curl -s -X POST "$PUBLIC_BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'
```

2. The response body includes a `token` field (and the `set-auth-token` response header). Use that value as the Bearer token.

3. Tokens expire with the session (default 7 days). Sign in again to refresh.

Role-based access is enforced exactly as in the SPA: admins can manage users/secrets, contributors can create agents, members see only agents they have access to.

## Claude Desktop connector

Add to your Claude Desktop MCP config (`claude_desktop_config.json`):

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
| `apps/api/src/mcp/controlPlane/server.ts`     | MCP tool registration                            |
| `apps/api/src/mcp/controlPlane/apiProxy.ts`   | Internal `app.request` proxy                     |
| `apps/api/src/mcp/controlPlane/apiCatalog.ts` | Endpoint discovery manifest                      |
| `apps/api/src/auth/index.ts`                  | `bearer()` plugin for token auth                 |

## Distinction from agent-runtime MCP

This control-plane MCP server is separate from:

- **Platform tools** (`memory_*`, etc.) — run in-process during agent runs
- **Third-party MCP servers** — external servers attached per agent via the MCP library

The control-plane server manages the deployment itself (agents, conversations, settings), not sandbox execution.
