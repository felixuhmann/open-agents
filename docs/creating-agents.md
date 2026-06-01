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

Choose a **provider** (Anthropic, OpenAI, or OpenRouter when configured
in Settings → Service secrets) and a **model** from the live Pi catalog.
Defaults are Anthropic `claude-opus-4-7`. Changing the model applies to
the next published version; live runs keep the snapshot they started with.

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

  If the agent has any platform tool bound, **Publish** also walks the
  vault: it creates the deployment vault on the very first publish (and
  saves its id under the `anthropic_vault_id` Secret key), then upserts a
  `static_bearer` credential mapping `${PUBLIC_BASE_URL}/mcp/<slug>` to
  `MCP_AUTH_TOKEN`. The credential id and bound URL are stored on the
  `Agent` row so re-publishes refresh the bearer in place rather than
  piling up duplicates. There is no manual `curl` step anymore.

Until you publish at least once, the chat surface returns `503` and
inbound email returns 200 + drop. The error toasts in the UI are
explicit about it.

## Step 5 — Try it

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
- **Attachment round-trip works on both surfaces.** Anthropic runs get a
  signed `REPLY_ATTACHMENT_UPLOAD_URL` the sandbox can `curl`. Daytona runs
  instead expose an `attach_run_file` tool (orchestrator pulls bytes from the
  sandbox) because sandboxes often cannot resolve `PUBLIC_BASE_URL`. The SPA
  chat renders downloadable links for files stored on the run either way.
  Inbound (user →
  agent) chat uploads ride a placeholder `ChatMessage` with role
  `pending_user_upload`; the next `POST messages` call reparents those
  attachments onto the real user message before enqueuing the run.
