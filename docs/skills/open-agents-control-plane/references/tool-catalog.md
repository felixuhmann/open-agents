# Control-Plane Tool Catalog

This catalog summarizes the MCP tools exposed by `apps/api/src/mcp/controlPlane/tools/`. Tool schemas from the connected MCP client are authoritative.

## Agents

- `agents_list`: List visible agents, including their categories for client-side filtering.
- `agents_create`: Create an agent draft. Accepts optional `category`; follow with `agents_get`, configuration updates, `agents_publish`, and a chat test.
- `agents_get`: Read full agent configuration by slug, including `profileAccessEnabled`.
- `agents_update`: Patch agent draft fields, including `category` (`null` clears it) and `profileAccessEnabled` (requester profile access). Replacement arrays must be complete.
- `agents_publish`: Freeze the current draft into a published `AgentVersion`.
- `agents_delete`: Permanently delete an agent. Use only when explicitly requested.
- `agents_list_access`: List explicit access users for restricted agents.
- `agents_delete_avatar`: Clear the agent avatar. Multipart avatar upload is not exposed through MCP.

## Workflows

- `workflows_list`: List visible workflows.
- `workflows_create`: Create a workflow draft.
- `workflows_get`: Read full workflow configuration by slug.
- `workflows_update`: Patch workflow draft fields. `steps` is a complete ordered replacement array.
- `workflows_publish`: Freeze the current draft into a published `WorkflowVersion`.
- `workflows_delete`: Permanently delete a workflow. Use only when explicitly requested.
- `workflows_list_access`: List explicit access users for restricted workflows.

## Conversations And Runs

- `conversations_list`: List chat conversations, optionally by `agentSlug`.
- `conversations_create`: Start a chat conversation. `firstMessage` starts a run immediately.
- `conversations_get`: Read metadata and message history. Prefer this for completed history.
- `conversations_trace`: Operator debug trace for runs, events, and timing.
- `conversations_send_message`: Enqueue a user message and start an agent run.
- `workflow_conversations_list`: List workflow conversations, optionally by `workflowSlug`.
- `workflow_conversations_create`: Start a workflow conversation.
- `workflow_conversations_get`: Read workflow conversation history.
- `workflow_conversations_trace`: Operator debug trace for workflow conversations.
- `workflow_conversations_send_message`: Enqueue a workflow conversation message.
- `runs_events`: SSE stream for live or replayed run events; not normal JSON.
- `workflow_runs_events`: SSE stream for workflow step run events; not normal JSON.
- `runs_list_attachments`: List files attached during an agent run.
- `runs_download_attachment`: Raw file bytes, not JSON.

## Library And Runtime Dependencies

- `tools_list`: List managed and platform tools. Use `Tool.id` for agent `toolBindings`.
- `models_catalog`: List model providers and model ids, including whether each provider is configured.
- `skills_list`: List uploaded skill bundles and versions.
- `skills_delete`: Delete a skill bundle. Use only when explicitly requested.
- `mcp_servers_probe_draft`: Test an unsaved external MCP URL.
- `mcp_servers_list`: List third-party MCP library entries.
- `mcp_servers_get`: Read an MCP library entry by id.
- `mcp_servers_create`: Register a third-party MCP server.
- `mcp_servers_update`: Update a third-party MCP server.
- `mcp_servers_delete`: Delete a third-party MCP server. Use only when explicitly requested.
- `mcp_servers_probe`: Probe a stored third-party MCP server, optionally with a bearer override.

## Users, Settings, Secrets, Sandboxes

- `profile_get`: Read the signed-in user profile, role, and optional profile fields (phone, address, company/job details, website, timezone).
- `profile_update`: Update the signed-in user's display name and optional profile fields.
- `users_list`, `users_create`, `users_update`, `users_delete`: Admin user management. `users_list` and `users_update` include optional profile fields for admins. Do not delete users unless explicitly requested.
- `settings_public`: Public branding settings.
- `settings_list`: Deployment app settings with plaintext values.
- `settings_upsert`: Set or clear an app setting by key. Empty string deletes the setting.
- `settings_delete`: Delete an app setting.
- `secrets_list`: List configured service secret keys, not values.
- `secrets_upsert`: Set an encrypted service credential.
- `secrets_delete`: Delete a service credential.
- `mcp_connection_info`: Get MCP URL and OAuth metadata for connecting clients.
- `mcp_connection_tokens_list`, `mcp_connection_tokens_create`, `mcp_connection_tokens_revoke`: Manual bearer token management.
- `sandboxes_list`: List Daytona sandboxes with filters.
- `sandboxes_orphans`: List provider sandboxes not registered in the DB.
- `sandboxes_reconcile`: Run lifecycle reconciliation.
- `sandboxes_by_conversation`, `sandboxes_by_thread`: Find sandbox metadata for a conversation or email thread.
- `sandboxes_get`, `sandboxes_sync`, `sandboxes_stop`, `sandboxes_start`, `sandboxes_archive`, `sandboxes_recover`, `sandboxes_delete`: Sandbox lifecycle operations. Treat stop/archive/delete as destructive.

## Issues, Analytics, Health

- `issues_create`: File an issue against a chat or workflow conversation.
- `issues_list`, `issues_get`, `issues_update`: Operator issue triage.
- `issues_email_report_prefill`, `issues_email_report_submit`: Public token-authenticated email issue report flow.
- `analytics_get`: Operator usage analytics.
- `health_check`: Liveness.
- `health_ready`: Readiness, including database connectivity.
