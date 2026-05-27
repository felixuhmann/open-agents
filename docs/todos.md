# Todos

Future v1.x / v2 ideas. The v1 milestone is "single-tenant, admin-driven
agent platform with web chat + email"; everything below is out of scope
for that.

## Top priority: reach feature parity with the old Anthropic backend

The Daytona/Pi MVP proves we can run a basic repo-owned chat agent, but
it is not yet a full replacement for the old Anthropic Managed Agents
backend. The old backend gave us four things at once:

1. An agent loop.
2. A sandbox/workspace with managed tools.
3. Skills + MCP tool hosting.
4. Managed session/files/lifecycle semantics.

The MVP now owns the first slice of that stack: it can select a
Daytona-backed `AgentBackend`, create/resume a Daytona sandbox, run a Pi
agent loop, call Anthropic models through Pi, and execute a small set of
sandbox-backed tools. The remaining work below is what blocks feature
parity.

### Skills in Daytona sandboxes

**Done (2026-05):** On new Daytona session creation, `materializeAgentSkills`
unpacks each pinned `AgentSkillBinding` zip into
`/workspace/.agents/skills/<slug>/`, adds Pi runtime instructions, emits
`skills.materialized` `RunEvent`s, and surfaces `skillsAvailable` on issue
runs. Skills are **copied per sandbox** (same pattern as attachments), not
mounted from shared storage.

Remaining (optional):

- Re-materialize or sync skills when bindings change on a resumed sandbox.
- Daytona snapshot/base-image caching for large skill libraries.

### MCP tools: platform and third-party

Current state:

- Platform MCP handlers already exist under `apps/api/src/mcp/platform`.
- Anthropic used to call our `/mcp/<slug>` route from its hosted
  sandbox.
- The Pi/Daytona runtime currently only exposes local managed tools
  (`bash`, `read`, `write`, etc.).

What is needed:

- Add an MCP client/adaptor on the orchestrator side so the Pi loop can
  expose platform tools as native Pi tools.
- Prefer host-side execution for platform MCP tools so service/tool
  secrets never need to enter the sandbox unless explicitly required.
- Add third-party MCP support by connecting to each
  `AgentThirdPartyMcp.serverUrl`, discovering tools, and adapting them
  into Pi tool definitions.
- Preserve existing per-binding config and encrypted tool secrets.
- Decide whether the existing `/mcp/<slug>` route remains only for
  backwards compatibility or becomes an internal implementation detail.

Acceptance criteria:

- Existing platform tools, starting with memory, work from Daytona runs.
- Third-party MCP tools attached in the agent editor can be called by the
  Pi loop.
- Tool calls/results show up in `RunEvent` with enough data to debug
  failures.

### Managed tool parity

Current MVP tools:

- `bash`
- `read`
- `write`
- `edit`
- `glob`
- `grep`
- `web_fetch`

Gaps versus Anthropic managed tools:

- `web_search` is not implemented.
- `read` is text-only and does not yet handle images, PDFs, notebooks, or
  rich previews.
- `bash` is one-shot command execution, not a long-lived shell session
  with background process management.
- Command output is returned at the end; stdout/stderr are not streamed
  live into `RunEvent`.
- `edit` is intentionally minimal exact-string replacement; it lacks the
  robustness and ergonomics of a mature patch/edit tool.
- There is no browser/computer-use equivalent.
- There is no policy layer for dangerous commands, network access,
  package installation, or long-running processes.

What is needed:

- Implement `web_search`, probably as a host-side platform tool or
  provider-backed search service rather than arbitrary scraping from the
  sandbox.
- Upgrade `read` to detect file type and return appropriate model-facing
  content or extracted text.
- Add shell-session semantics on top of Daytona process sessions/PTYs:
  create/reuse session, send commands, poll/stream logs, terminate
  background work.
- Stream command output into run events, while still returning compact
  tool results to the model.
- Add better limits: max command runtime, max output chars, max file read
  size, and clear truncation messages.

Acceptance criteria:

- Agents using the same managed tool checkboxes in the UI get comparable
  behavior on Daytona.
- Long commands visibly stream progress in the chat/event timeline.
- The model can inspect common uploaded file types without manual
  conversion by the user.

### Publish/version semantics

Current state:

- The old `publishAgent()` pushed config to Anthropic and stored an
  `AgentVersion` snapshot.
- Daytona MVP can run without an Anthropic publish, but that means the
  old "published version" mental model is partially bypassed.

What is needed:

- Replace "publish to Anthropic" with "publish/freeze local runtime
  config".
- Store a provider-neutral `AgentVersion.payload` containing:
  - system prompt
  - model/provider
  - managed tools
  - platform tools
  - third-party MCP servers
  - skill version pins
  - sandbox/runtime settings
- Link each `AgentRun` to the version/config it used, or otherwise make
  this derivable in issue/debug bundles.
- Update UI copy so admins understand that publish freezes local runtime
  config instead of provisioning Anthropic resources.

Acceptance criteria:

- A run can be audited later against the exact agent config it used.
- Daytona does not require `anthropicAgentId`, `environmentId`, or
  Anthropic agent versions.
- The old Anthropic backend can remain available during migration without
  confusing the version model.

### Model-provider abstraction

Current state:

- Pi provides a model-provider seam.
- MVP still uses the stored Anthropic API key and currently resolves
  Anthropic model IDs.

What is needed:

- Add service secrets for additional providers: OpenAI, Google/Vertex,
  OpenRouter, Bedrock, etc.
- Add a provider/model registry in the backend and expose it to the web
  app.
- Update the agent editor so `Agent.model` is no longer effectively an
  Anthropic-only string.
- Decide how to represent provider + model in the DB. Options:
  - keep one string like `anthropic:claude-opus-4-7`
  - add explicit `modelProvider` + `modelId` fields
  - store provider config in a JSON runtime config field
- Normalize usage/cost events across providers so analytics keep
  working.

Acceptance criteria:

- An admin can configure at least one non-Anthropic provider and select a
  model for an agent.
- The same Daytona sandbox/tool runtime works regardless of model
  provider.
- `model.request` events include provider/model/usage consistently.

### Daytona sandbox lifecycle management

Current state:

- MVP creates Daytona sandboxes and stores session references in existing
  chat/email session fields.
- Daytona auto-stop/archive settings are set during creation, but the app
  has no first-class lifecycle UI or cleanup jobs yet.

What is needed:

- Add explicit sandbox metadata/state in the DB rather than encoding
  everything inside existing Anthropic-named session fields.
- Track sandbox ID, provider, state, last activity, owning agent,
  conversation/thread, and current lifecycle policy.
- Add admin/operator controls for stop, start, archive, delete, and
  recover.
- Add cleanup/reconciliation jobs for stale or orphaned sandboxes.
- ~~Stop forcing new sessions for attachments on the Daytona path~~ (done:
  resumed sandboxes call `mountSessionResources`).
- Decide attachment semantics for edge cases (sandbox stopped/archived,
  mount failures, very large files).
- Handle Daytona error states and recoverable failures cleanly.

Acceptance criteria:

- Admins can see which sandbox backs a conversation/thread.
- Stale sandboxes do not accumulate indefinitely.
- New attachments are available to the agent without unnecessary sandbox
  churn.

### Observability and debug parity

Current state:

- Existing `RunEvent`/SSE infrastructure works and is a strong reusable
  foundation.
- MVP emits agent deltas, full messages, tool use/results, and model
  request usage.

What is needed:

- Add sandbox lifecycle events: create, start, stop, archive, recover,
  delete, upload attachment, materialize skills.
- Capture tool args and structured result summaries where safe.
- Stream stdout/stderr separately for command tools.
- Add Daytona sandbox IDs and runtime metadata to issue/debug bundles.
- Preserve enough provider payload/response metadata to diagnose model
  failures without leaking secrets.
- Make analytics provider-neutral.

Acceptance criteria:

- Debugging a failed Daytona run is at least as easy as debugging the old
  Anthropic run.
- Issue bundles include the full chain: user message -> runtime config ->
  sandbox -> tools -> model requests -> final output/error.

### Sandbox security and policy

Current state:

- Daytona gives isolation, but the app does not yet own a detailed
  runtime policy.
- MVP tools are intentionally permissive.

What is needed:

- Define default sandbox network policy: internet on/off, allowlists,
  internal network protection.
- Add command policy controls: deny rules, approval gates, max runtime,
  max output, max background process lifetime.
- Keep credentials host-side by default. Only inject credentials into the
  sandbox when a tool explicitly requires sandbox-local access.
- Add resource limits and per-agent/per-run quotas.
- Ensure cleanup guarantees for generated files, temporary credentials,
  archived sandboxes, and failed runs.

Acceptance criteria:

- Admins can reason about what a sandbox can access.
- A compromised or confused agent has bounded blast radius.
- Sensitive service credentials are not written into prompts, logs, or
  sandbox files by default.

### Tests and smoke coverage

Current state:

- `pnpm check` passes.
- No live Daytona run was exercised in CI because it requires real
  credentials.

What is needed:

- Add unit tests for runtime config translation and tool adapters.
- Add mocked Daytona tests for create/resume/upload/tool execution paths.
- Add mocked Pi event tests to verify `RunEvent` mapping.
- Add an optional live smoke test gated by `DAYTONA_API_KEY` and model
  provider credentials.
- Add regression coverage for attachments, skill materialization, MCP
  tool calls, and sandbox lifecycle reconciliation.

Acceptance criteria:

- The self-hosted runtime can be changed without manually testing every
  tool path.
- CI covers the provider-neutral behavior; live credentials only enable
  optional smoke coverage.

## Per-collection memory schemas (v1.5)

The current memory tool stores arbitrary JSON. We can do better: let
admins declare a Zod-style shape per `(agentId, collection)` and have
`memory_create` / `memory_update` validate against it. Surfaces in the
UI as a small schema editor on the agent edit page.

## No-code "webhook tool" (v1.5)

Generic platform tool that, when bound, lets an admin point an agent at
an arbitrary HTTPS endpoint with declarative request/response shapes.
Sits in the catalog like `memory` does. Useful for "give the agent a
read-only view of my CRM" without writing a custom MCP server.

## SSO / SAML / OAuth login providers (v2)

better-auth supports these out of the box. v1 sticks to email/password
because we want zero external dependencies for the on-prem story.

## Multi-tenant data scoping (probably never)

The v1 design is **explicitly single-tenant**: one deployment, one
database, one customer. Adding multi-tenancy means scoping every row by
a `tenantId`, isolating per-tenant Postgres roles, namespacing the MCP
auth token per tenant, and a control-plane to provision new tenants. We
think the right answer is to keep shipping `docker compose up` per
customer.

## Control plane for cross-customer deploy provisioning (v2 if at all)

Today, spinning up a new customer is "clone the deploy, set env, run
migrations". A control plane would automate that and let the operator
manage every deployment from a single dashboard. It's a separate product
and should not bleed into this codebase.

## Cross-thread continuation between email and web chat

Out of scope and likely to stay that way. Different surfaces, different
permission models, ambiguous threading semantics.

## support for new models

instead of anthropic only, we ideally also want to support gpt models and others. this will probably entail a large refactor of the product, as we need to use a different sandbox backend, currently we are heavily coupled to the anthropic solution.

## intl

we want to support different languages, at least english and german for now. configured by an admin through the settings for the whole instance globally. (also add a local overwrite in the profile settings)

## s3 storage compatibility

right now we write everything to disk. this is not acceptable, as a admin i want to be able
to have a s3 compatible integration for all the stuff that needs persistent storage in the app (images, skills, other uploads, ...)

## unify ui

email ui and email link ui design is different from the main web app. unify the styling across everything, make it consistent.
