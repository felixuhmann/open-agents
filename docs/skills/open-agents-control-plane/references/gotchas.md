# Gotchas And Troubleshooting

## Publishing

Creating or updating an agent or workflow only changes the draft. A run uses a published version. Always call `agents_publish` or `workflows_publish` after draft changes unless the user explicitly wants an unpublished draft.

After publishing, verify with `agents_get` or `workflows_get`. Look for `publishedAt`, `currentVersionId`, or `currentVersionNumber`.

Workflow publish freezes the agent versions referenced by its steps. If an agent changed, publish the agent first, then publish the workflow again.

## Replacement Semantics

These fields replace the prior value when included:

- Agent `starterPrompts`
- Agent `toolBindings`
- Agent `skillIds`
- Agent `skillBindings`
- Agent `mcpServerIds`
- Agent `accessUserIds`
- Workflow `starterPrompts`
- Workflow `steps`
- Workflow `accessUserIds`

Read current state first and send the complete desired array.

## Surface-Specific Checks

For chat, `webEnabled` must be true for normal web use. Test with `conversations_create` or `conversations_send_message`.

For email, `emailEnabled` must be true and `inboundLocalPart` must be set. Mailgun requires `mailgun_api_key`, `mailgun_domain`, and `mailgun_signing_key` service secrets. Outbound sender behavior may also depend on the `inbound_from` setting.

Chat and email do not share conversation state. Do not expect a chat conversation to include email thread history.

## Credentials

Service credentials are stored as encrypted secrets, not normal environment variables:

- `anthropic_api_key`
- `openai_api_key`
- `openrouter_api_key`
- `daytona_api_key`
- `mailgun_api_key`
- `mailgun_domain`
- `mailgun_signing_key`

Use `secrets_list` to check presence. Use `secrets_upsert` only with a user-provided value.

## Tool And Skill Bindings

`toolBindings[].toolId` must use ids from `tools_list`. Do not pass tool names such as `bash` or `memory` as ids unless the catalog actually returns those ids.

Managed tools run in Daytona. Platform tools run on the API host. Third-party MCP servers are separate library entries attached by `mcpServerIds`.

Uploaded agent skills materialize into Daytona sandboxes when a sandbox is created. Changing skill bindings mid-conversation does not necessarily re-sync an existing sandbox; start a new session or sandbox if the run must see new skill files.

## MCP Server Confusion

There are two different MCP concepts:

- The control-plane MCP server at `/mcp` lets external clients manage Open Agents.
- Third-party MCP library servers are attached to agents so they can call external tools during runs.

Do not try to attach the control-plane server to itself as a third-party library server unless the user has a deliberate reason.

## MCP Limitations

Multipart uploads are not represented as MCP tools. Agent avatars, chat attachments, skill bundle zips, and branding image uploads require the web UI or direct HTTP.

SSE tools return `text/event-stream`, not JSON. Use them for live progress or replay; use conversation `*_get` tools for durable history.

Binary attachment downloads return raw bytes.

The setup wizard is not part of the control-plane MCP surface once users exist.

## Permissions

Roles are enforced by the same API as the web UI:

- Admin: users, secrets, most deployment settings, MCP server library mutation, sandboxes.
- Contributor/operator: create and manage agents/workflows and inspect operator traces depending on the route.
- Member/user: use visible agents, conversations, and allowed reads.

If a tool fails with authorization, report the required role and stop instead of retrying with guessed credentials.

## Destructive Operations

Treat these as destructive and require explicit user intent:

- `agents_delete`
- `workflows_delete`
- `users_delete`
- `skills_delete`
- `mcp_servers_delete`
- `settings_delete`
- `secrets_delete`
- `mcp_connection_tokens_revoke`
- sandbox stop, archive, delete

Prefer listing and confirming identifiers before destructive changes.
