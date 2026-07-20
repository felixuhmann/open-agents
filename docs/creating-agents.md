# Creating agents

Agents are created and configured entirely from the SPA. There is no code path for adding an agent.

1. Sign in as an admin or contributor.
2. Open `/agents` and create a new agent.
3. Configure the category, system prompt, model provider/model, web/email surfaces, tools, skills, external MCP servers, ACL, and sandbox policies.
4. Click **Publish new version** to freeze the current draft into `AgentVersion`.

Publishing does not call an external agent API. The local `AgentVersion.payload` is the source of truth for future runs.

## Tools

- `managed` tools run in the OpenSandbox sandbox.
- `platform` tools run on the orchestrator through handlers under `apps/api/src/mcp/platform/`.
- External MCP servers are configured in the MCP library and attached per agent.

## Skills

Skill bundles are uploaded as zip files with a `SKILL.md`. The API stores the bundle under `apps/api/data/skills/` and records a `SkillVersion`. OpenSandbox materializes pinned bundles into the sandbox at creation time.

## Attachments

User uploads are stored on chat/email attachment rows and mounted into the sandbox for the next run. Existing OpenSandbox sandboxes can receive new files through `mountSessionResources`, so attachments do not force session rotation.

Agent-created downloadable files should be returned with the `attach_run_file` tool. The orchestrator pulls the file bytes from the sandbox and stores `AgentAttachment` rows for chat links and outbound email attachments.
