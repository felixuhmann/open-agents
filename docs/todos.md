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

**Done (Daytona / Pi path):** orchestrator-side adapter in
`apps/api/src/mcp/piTools.ts` — platform tools invoke in-process;
third-party servers use the MCP SDK client. `/mcp/<slug>` kept for
Anthropic Managed Agents. Library → **MCP** page is a coming-soon shell
for deployment-wide presets.

**Follow-ups:**

- Deployment-wide MCP catalog (Library page) instead of per-agent URLs only.
- OAuth / stdio transports for third-party servers.
- Cache `tools/list` per agent revision to avoid reconnecting every run.

### Managed tool parity (Daytona)

**Done:**

- `bash` / `grep` — persistent Daytona process session (`open-agents-shell`)
  via `executeSessionCommand` + streaming `getSessionCommandLogs`
  (`apps/api/src/services/daytonaExec.ts`).
- Live stdout/stderr → `tool.output` RunEvents (throttled); chat UI renders
  output while commands run.
- Limits + truncation messages (`apps/api/src/services/daytonaLimits.ts`).
- Basic shell policy guardrails (`apps/api/src/services/shellPolicy.ts`).

**Still open:**

- `web_search` — not on Daytona; use `curl` in bash or a third-party MCP
  search server.
- Rich `read` (images, PDF, notebooks) — UTF-8 text only for now.
- Browser / computer-use equivalent.
- Stronger policy (package installs, egress, background job registry +
  kill).
- `web_fetch` — optional; bash `curl` covers many cases.

### Publish/version semantics

Implemented:

- **Publish new version** freezes local runtime config into
  `AgentVersion.payload` (provider-neutral snapshot).
- Each `AgentRun` pins `agentVersionId` at enqueue time.
- Daytona runs against published snapshots; no Anthropic publish required.
- Legacy Anthropic sync lives in `syncAgentToAnthropic()` (deprecated, not
  exposed in the UI).

Remaining (future):

- Model-provider abstraction beyond Anthropic model ids.
- Full removal of Anthropic Managed Agents backend.

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

**Done (Daytona path):**

- Sandbox lifecycle `RunEvent`s: `sandbox.created`, `sandbox.started`,
  `sandbox.recovered`, `sandbox.resource_mounted` (plus existing
  `skills.materialized`). Admin stop/archive/delete remain on
  `AgentSandbox` rows (not run-scoped).
- Redacted `tool.use` args and summarized `tool.result` payloads;
  `rawType` / `stopReason` / `provider` on model and tool events.
- Issue bundles join `AgentSandbox` metadata and per-run
  `providerSandboxId` / `workspaceDir` / `runtimeBackend`.
- Analytics groups by provider; spend only when a model price is known.
- Live chat renders final `tool.result` text alongside streamed output.

**Follow-ups:**

- Run-scoped events for operator-initiated sandbox stop/archive/delete.
- Broader `tool.output` streaming for non-shell tools (e.g. `web_fetch`).
- Optional dedicated audit log table for sandbox admin actions.

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
