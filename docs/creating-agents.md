# Creating agents

Agents are created and configured entirely from the SPA. There is no code path for adding an agent.

1. Sign in as an admin or contributor.
2. Open `/agents` and create a new agent.
3. Configure the category, system prompt, model provider/model, web/email surfaces, tools, skills, external MCP servers, ACL, and sandbox policies.
4. Click **Publish new version** to freeze the current draft into `AgentVersion`.

Publishing does not call an external agent API. The local `AgentVersion.payload` is the source of truth for future runs.

## Tools

- `managed` tools run in the agent's sandbox, on whichever provider is active.
- `platform` tools run on the orchestrator through handlers under `apps/api/src/mcp/platform/`.
- External MCP servers are configured in the MCP library and attached per agent.

## Skills

Skill bundles are uploaded as zip files with a `SKILL.md`. The API stores the bundle under `apps/api/data/skills/` and records a `SkillVersion`. Pinned bundles are materialized into the sandbox at creation time.

## Attachments

User uploads are stored on chat/email attachment rows and mounted into the sandbox for the next run. Existing sandboxes can receive new files through `mountSessionResources`, so attachments do not force session rotation.

Agent-created downloadable files should be returned with the `attach_run_file` tool. The orchestrator pulls the file bytes from the sandbox and stores `AgentAttachment` rows for chat links and outbound email attachments.

## Sandbox network policy

Each agent carries a network policy: internet on/off, an optional CIDR egress
allow list, and internal-network protection. What it means depends on the
active provider.

Under **Daytona**, all three apply as before.

Under the **self-hosted broker**, egress is all-or-nothing:

| Agent policy                      | Broker behaviour                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Internet off                      | No network at all                                                                                                   |
| Internet on, empty allow list     | Public IPv4 only; private, loopback, link-local, metadata, Docker gateway and host addresses blocked; IPv6 disabled |
| Internet on, non-empty allow list | **Rejected**, with remediation                                                                                      |

Broker v1 has no CIDR allow list. An agent that has one fails closed rather than
being silently widened, and the agent editor surfaces the incompatible value
with a link to change providers. Internal-network protection is always enforced
under the broker regardless of the stored value.
