---
name: open-agents-control-plane
description: Operate an Open Agents deployment through its control-plane MCP server. Use when creating, updating, publishing, testing, debugging, or administering agents, workflows, conversations, MCP library entries, tool bindings, skill bindings, users, settings, secrets, sandboxes, issues, or analytics via tools such as agents_create, agents_update, agents_publish, workflows_publish, conversations_send_message, mcp_servers_probe, and settings_upsert.
---

# Open Agents Control Plane

## Operating Model

Use the control-plane MCP server to manage the Open Agents deployment itself. It is separate from the tools an agent can call inside a run.

Treat agents and workflows as draft-first resources. `agents_create`, `agents_update`, `workflows_create`, and `workflows_update` change drafts. Always publish after meaningful configuration changes unless the user explicitly asks to leave a draft unpublished.

Before mutating, read current state and library catalogs. Use `agents_get`, `workflows_get`, `tools_list`, `models_catalog`, `skills_list`, and `mcp_servers_list` so updates preserve existing choices and use valid ids.

Many update fields use replacement semantics. When patching `toolBindings`, `skillIds`, `skillBindings`, `mcpServerIds`, `accessUserIds`, workflow `steps`, or `starterPrompts`, send the complete desired array, not only the item being added.

## Standard Workflow

1. Establish context with `profile_get` and, when availability matters, `health_ready`. Confirm the caller has the required role for the operation.
2. Inspect the target with the relevant `*_list` or `*_get` tool. If creating, check for slug conflicts first.
3. Inspect catalogs before binding dependencies: use `models_catalog` for model/provider ids, `tools_list` for managed/platform tool ids, `skills_list` for skill/version ids, and `mcp_servers_list` for third-party MCP server ids.
4. Create or update the draft. Preserve replace-semantics arrays from the prior state unless intentionally changing them.
5. Publish the draft with `agents_publish` or `workflows_publish` after configuration changes. Confirm `publishedAt`, `currentVersionId`, or `currentVersionNumber` changed.
6. Test the published surface. For agents, create a chat with `conversations_create` or send with `conversations_send_message`, then read history with `conversations_get`. For workflows, use `workflow_conversations_create` or `workflow_conversations_send_message`, then `workflow_conversations_get`.
7. If a run fails or behaves unexpectedly, use `conversations_trace` or `workflow_conversations_trace` as an operator. Use SSE tools only for live progress; prefer the `*_get` tools for completed history.

## Agent Checklist

When creating or substantially changing an agent:

- Choose a slug matching lowercase letters, digits, and dashes; max 60 characters.
- Set a clear `displayName`, `description`, `systemPrompt`, and optional `starterPrompts`.
- Select a configured model from `models_catalog`. If the provider is not configured, tell the user which service secret is missing instead of guessing credentials.
- Set `webEnabled` and `emailEnabled` intentionally. If email is enabled, set a valid `inboundLocalPart` and check Mailgun secrets if delivery matters.
- Bind tools with `toolBindings` using `Tool.id` values from `tools_list`, not tool names.
- Bind uploaded skills with `skillBindings` when a specific version is needed. Use `skillIds` only when the API/client schema makes that the intended shortcut.
- Attach third-party MCP servers with `mcpServerIds` after probing or verifying the library entry.
- Set `accessMode` and `accessUserIds` together when restricting access.
- Publish with `agents_publish`, then verify with `agents_get`.
- Run a minimal chat test through the MCP conversation tools before declaring the agent ready.

## Workflow Checklist

When creating or changing a workflow:

- Ensure every step references an existing agent id from `agents_list` or `agents_get`.
- Ensure each step agent has a published version before publishing the workflow. A workflow publish freezes the referenced agent versions.
- Send the full ordered `steps` array on update.
- Publish with `workflows_publish`, then test through `workflow_conversations_create` or `workflow_conversations_send_message`.

## Third-Party MCP Library

Use the MCP library tools for external MCP servers attached to agents:

1. Probe an unsaved URL with `mcp_servers_probe_draft`.
2. Create or update the library entry with `mcp_servers_create` or `mcp_servers_update`.
3. Probe the stored entry with `mcp_servers_probe`.
4. Attach the server id to the agent with `agents_update` using the complete `mcpServerIds` array.
5. Publish the agent.

Do not confuse this library with the control-plane MCP server itself. Library servers are tools available during agent runs.

## Safety Rules

Do not delete agents, workflows, users, skills, MCP servers, sandboxes, secrets, settings, bearer tokens, or issues unless the user explicitly asks for that destructive action.

Do not expose secret values. `secrets_list` only reports configured keys; `secrets_upsert` requires the user to provide the value.

Do not assume uploads are available through MCP. Multipart uploads such as avatars, skill bundle zips, and chat attachments require the web UI or direct HTTP.

Prefer exact MCP tool schemas shown by the client over memory if they differ from this skill.

## References

- Read `references/workflows.md` for end-to-end procedures.
- Read `references/tool-catalog.md` for the control-plane tool groups and follow-up actions.
- Read `references/gotchas.md` for publishing, replacement semantics, permissions, limitations, and troubleshooting.
