# Creating a new agent

The whole point of v1 is that creating an agent is **a UI flow with no
code changes**. This page is the recipe for an admin doing it the first
time, plus the conventions that protect you from yourself.

If you need to add a new **platform tool** (a code-shipped MCP handler
exposed to the catalog), see [`mcp-tools.md`](mcp-tools.md). If you
need to add a new **skill bundle**, see [`operations.md`](operations.md).

## What "an agent" actually is in v1

Two halves:

- **In our database** (`Agent` row + bindings): slug, display name,
  system prompt, model, web/email toggles, access mode, inbound
  local-part, tool bindings (managed + platform, in one table),
  third-party MCP server URLs, skill bindings. This is the source of
  truth.
- **In Anthropic's API**: a mirror of the above, created via
  `POST /v1/agents/{id}` when you click **Publish to Anthropic**. We
  store the returned `anthropicAgentId`, `environmentId`, and version
  on the `Agent` row.

There is no per-agent code in this repo. There is no `AGENTS` array.
Removing an agent is `DELETE /api/agents/<slug>`, which also tears down
its bindings, conversations, and email threads.

## Step 1 — Sign in as admin

The first deployment runs through `/setup`, which creates the first
admin and stores Anthropic + Mailgun credentials. Subsequent admins are
invited from `/settings/users`.

## Step 2 — Create the agent

`/agents` → **New agent**:

- **Display name** — shown in the SPA, the chat header, and outbound
  emails.
- **Slug** — lowercase, hyphenated. Used as:
  - chat URL (`/agents/<slug>/chat`)
  - MCP URL Anthropic calls back into (`<PUBLIC_BASE_URL>/mcp/<slug>`)
  - default inbound local-part (overridable on the edit page)
- **Description** — internal note for the agent list.

The create endpoint also pre-creates an empty `inboundLocalPart = slug`
and seeds an empty system prompt.

## Step 3 — Configure on the edit page

`/agents/<slug>/edit` is the single configuration surface.

### Identity

- **Display name** + **Description** (free-form).
- **Inbound local-part** — defines the email address as
  `<localPart>@<MAILGUN_DOMAIN>`. Must be unique across the deployment.
- **System prompt** — multiline. This becomes Anthropic's system prompt
  on the next publish.

### Surfaces

- **Web chat enabled** — controls whether `/agents/<slug>/chat` is
  reachable.
- **Email enabled** — controls whether the catch-all webhook accepts
  inbound mail for this address.
- **Access** — `Everyone in org` or `Specific users`. When specific,
  the access list is editable below.

### Model

Pick the Anthropic model that powers the agent. Default is
`claude-opus-4-7`. Switching the model is a publish-only change — the
new id ships to Anthropic on the next **Publish** click.

### Tools

A single picker, grouped by runtime:

- **Managed by Anthropic** — members of `agent_toolset_20260401`
  (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`,
  `web_search`). Ticking one adds an entry to the published agent's
  `agent_toolset_20260401.configs[]` array. Anthropic's container runs
  the actual code.
- **Platform (this backend)** — code-shipped MCP handlers in
  [`apps/api/src/mcp/platform/index.ts`](../apps/api/src/mcp/platform/index.ts).
  Ticking one adds an `AgentToolBinding`; the published agent gets an
  `mcp_toolset` block referencing our `/mcp/<slug>` endpoint.

Both kinds share one binding table (`AgentToolBinding`) and one catalog
(`Tool`). Per-binding configuration / secrets live on the binding row
(admins set them via the binding editor on this page).

### Skills

Anthropic-side skill bundles uploaded from `/library/skills`. Tick to
attach. The next publish includes their `anthropicSkillId`.

### Third-party MCP servers

Paste a label + HTTPS URL. The row lands in `AgentThirdPartyMcp`. On
publish, each row becomes an entry in the agent's Anthropic-side
`mcp_servers` array; Anthropic's sandbox connects to them directly
without going through our backend.

If the server needs a bearer token, it is stored AES-GCM encrypted
inline on the same row (`bearerCipher` / `bearerIv` / `bearerTag`)
rather than as a separate `Secret` row — the binding is per-agent
anyway, so a dedicated `Secret` row would just add a join.

## Step 4 — Save and publish

The page has two actions:

- **Save** — persists the row + bindings only. Useful while iterating
  on the prompt without bouncing Anthropic.
- **Publish to Anthropic** — calls
  [`provisioning.upsertAnthropicAgent`](../apps/api/src/anthropic/provisioning.ts):
  builds the payload, calls `POST /v1/agents/{id}` (or `update`),
  inserts a new `AgentVersion` row carrying the full payload snapshot,
  and stamps `Agent.anthropicAgentVersion` with the version string
  Anthropic returned. Subsequent sessions reference this
  `anthropicAgentId`/`anthropicAgentVersion`.

Until you publish at least once, the chat surface returns `503` and
inbound email returns 200 + drop. The error toasts in the UI are
explicit about it.

## Step 5 — One-shot Anthropic vault entry (only if you bound platform tools)

Anthropic's sandbox needs a `static_bearer` credential mapping the agent's
MCP URL to your `MCP_AUTH_TOKEN`. The setup wizard can pre-create one for
the deployment, but each new slug needs its own entry. From a shell with
the API key:

```bash
curl -sS https://api.anthropic.com/v1/vaults/$VAULT_ID/credentials \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{
        "type": "static_bearer",
        "url": "https://<your-deploy>/mcp/<slug>",
        "token": "<MCP_AUTH_TOKEN value>"
      }'
```

Without it the sandbox can authenticate against `/mcp/<slug>` and tool
calls fail with `401` (the agent reports a generic tool error).

This is the only place where adding an agent still requires a manual
step outside the UI; it exists because Anthropic's vault model wasn't
designed for our turnkey UX. We may automate it in v1.5 by managing the
vault from the Secret service.

## Step 6 — Try it

- Open `/agents/<slug>/chat` and send a message. Inspect the SSE stream
  in DevTools to confirm tool calls render correctly.
- Email `<localPart>@<MAILGUN_DOMAIN>`. Watch the API logs for
  `mailgun inbound: received` → `run-agent: streaming` →
  `send-email: done`.

## Conventions that protect you from yourself

These are non-obvious rules; some are now enforced in code, others by
convention.

### Slugs are forever

Once an agent has any conversations, runs, or email threads, do not
rename the slug. The slug is the URL path, the MCP route key, and the
inbound local-part default; renaming would orphan everything. Create a
new agent and migrate manually if needed.

### Email and chat never share state

Each surface gets its own thread/conversation table and creates
independent Anthropic sessions. There is no "continue this email in chat"
flow and there won't be one in v1.

### Per-binding secrets, not per-agent envs

If a tool needs a credential (OAuth token, API key, …), it goes on the
`AgentToolBinding` as a `Secret` row with `scope = "tool"`. Don't add
new env vars for tool-specific credentials — they belong in the DB so
admins can rotate them through the UI.

### Publish is not automatic

`Save` is local-only. The Anthropic mirror only updates when you click
**Publish to Anthropic**. This is on purpose: it lets admins draft long
prompt edits without bouncing live sessions.

### One Mailgun route, ever

There is one catch-all Mailgun route per deployment. Do not add a
per-slug route — the webhook resolves the agent by parsing the
recipient. The setup wizard prints the single URL the operator must
configure.

## Gotchas

The list of things that have actually surprised someone:

- **New attachments force a new Anthropic session.** Managed Agents
  only mounts `resources` at session-creation time, so the run-agent
  worker always creates a new session whenever a turn carries new
  attachments and resumes the existing one otherwise. Don't try to
  bypass it.
- **`PUBLIC_BASE_URL` ends up in the published agent.** It's the host
  used for the `mcp_servers[].url` entry. If you change the public
  origin, re-publish every agent so Anthropic gets the new URL.
- **Anthropic beta headers `managed-agents-*` and `agent-api-*` are
  mutually exclusive.** Use the existing `AnthropicAgentBackend`; don't
  open raw `fetch` calls to Anthropic from app code.
- **`run-agent` worker errors must persist failure state.** The
  canonical pattern is in
  [`apps/api/src/jobs/runAgent.ts`](../apps/api/src/jobs/runAgent.ts):
  outer `try/catch` marks `AgentRun.status = "failed"`, emits a
  `run.failed` `RunEvent`, and re-throws so pg-boss retries see the
  failure. Bare throws make pg-boss retry silently with no DB trace.
- **Skills are deployed by uploading the zip in the UI.** The bundle is
  stored locally under `data/skills/` and reflected to Anthropic via the
  Skills API. Bumping a skill is "delete + re-upload" in v1; live
  rebinding lands later.
- **Memory tool collections are per-agent.** The `memory_*` operations
  are scoped to the calling agent's `agentId` from the MCP request
  context, so two agents can't read each other's memory. There's no
  cross-agent shared memory in v1.
