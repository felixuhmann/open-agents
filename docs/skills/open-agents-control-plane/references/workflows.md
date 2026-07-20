# End-to-End Workflows

## Create And Publish An Agent

1. Call `agents_list` to check whether the requested slug already exists.
2. Call `models_catalog` and choose an available `modelProvider` and `modelId`. Prefer a configured provider.
3. Call `tools_list`, `skills_list`, and `mcp_servers_list` if the user wants tools, skills, or external MCP.
4. Call `agents_create` with `slug`, `displayName`, optional `description`, optional `category`, and initial `systemPrompt`.
5. Call `agents_get` to read defaults and the new agent id.
6. Call `agents_update` with the full desired draft:
   - `category` if the user wants list-view grouping or filtering
   - `systemPrompt`
   - `modelProvider` and `modelId`
   - `webEnabled`, `emailEnabled`, and `inboundLocalPart`
   - `profileAccessEnabled` when the agent should see the requester profile
   - `starterPrompts`
   - `toolBindings`
   - `skillBindings` or `skillIds`
   - `mcpServerIds`
   - `subagentIds` when the agent should delegate to other agents via `run_subagent`
   - `accessMode` and `accessUserIds`
   - sandbox policies if requested
7. Call `agents_get` again and verify the draft matches the request.
8. Call `agents_publish`.
9. Call `agents_get` and verify a published version exists through `publishedAt`, `currentVersionId`, or `currentVersionNumber`.
10. Test the web surface if enabled:
    - Call `conversations_create` with `agentSlug` and `firstMessage`, or create an empty conversation and call `conversations_send_message`.
    - Call `conversations_get` to inspect message history.
    - If the result is unclear and you have operator access, call `conversations_trace`.

Never stop after `agents_create` or `agents_update` when the user expects a usable agent. Publish and test.

## Update An Existing Agent

1. Call `agents_get`.
2. Read current arrays before changing any replace-semantics field.
3. Call catalog tools if ids are needed:
   - `tools_list` for `toolBindings[].toolId`
   - `skills_list` for skill and version ids
   - `mcp_servers_list` for third-party MCP ids
   - `agents_list` for `subagentIds` when changing delegation
   - `models_catalog` for model ids
4. Call `agents_update` with only the fields being changed (including `category` when recategorizing, `profileAccessEnabled` for requester profile access, or `null` to clear nullable fields), except arrays must be complete desired arrays.
5. Call `agents_get` to verify draft state.
6. Call `agents_publish` unless the user asked to save a draft only.
7. Call `agents_get` again to confirm publication.
8. Run a focused chat test if the change affects runtime behavior.

## Register And Attach A Third-Party MCP Server

1. If the user gives a URL, call `mcp_servers_probe_draft` with `serverUrl` and optional bearer.
2. If the probe fails, report the status and diagnostics. Do not attach a failing server unless the user explicitly accepts the risk.
3. Call `mcp_servers_create` or `mcp_servers_update`.
4. Call `mcp_servers_probe` on the stored entry.
5. Call `agents_get` for each target agent.
6. Call `agents_update` with the complete `mcpServerIds` array.
7. Call `agents_publish`.

## Upload And Bind A Skill Bundle

1. Package the skill as a `.zip` whose top level contains a `SKILL.md`.
2. Call `skills_create` with the skill `name` (and optional `description` for a brand-new skill). Reusing an existing name uploads a new version; a new name creates a new skill.
3. `PUT` the raw zip bytes to the returned `uploadUrl` before it expires (single-use, ~15 min), for example `curl -X PUT --data-binary @bundle.zip "<uploadUrl>"`.
4. Call `skills_list` to confirm the skill and its new version id.
5. Bind it to an agent with `agents_update` using `skillBindings` (pin `skillId` + `skillVersionId`) or `skillIds`, then `agents_publish`.

## Create And Publish A Workflow

1. Call `agents_list` and collect ids for the step agents.
2. For each step agent, call `agents_get` if needed to verify `currentVersionId` or `currentVersionNumber` is present. If a later step needs requester profile data, verify that step agent has `profileAccessEnabled` enabled and published.
3. Call `workflows_create` with `slug`, `displayName`, and optional `description`.
4. Call `workflows_update` with `steps` as the complete ordered list of `{ agentId }` objects. Set surfaces and access fields intentionally.
5. Call `workflows_get` and verify all steps are present and `agentPublished` is true for every step.
6. Call `workflows_publish`.
7. Call `workflows_get` and verify a published version exists.
8. Test through `workflow_conversations_create` or `workflow_conversations_send_message`, then inspect with `workflow_conversations_get`.

## Diagnose A Failed Or Bad Run

1. Get the conversation with `conversations_get` or `workflow_conversations_get`.
2. If you need operator details, call `conversations_trace` or `workflow_conversations_trace`.
3. For files produced by a run, use `runs_list_attachments`; download only when the user needs the bytes.
4. Use `runs_events` or `workflow_runs_events` only for live streaming or replay from `lastEventId`. These tools return SSE, not JSON.
5. Common checks:
   - Agent or workflow was not published after a draft edit.
   - Model provider secret is missing.
   - OpenSandbox runtime env (`OPENSANDBOX_BASE_URL`) is unset or unreachable for sandbox tools.
   - Mailgun secrets or inbound local part are missing for email.
   - External MCP server probe fails or auth is missing.
   - A replacement array accidentally dropped a binding.
