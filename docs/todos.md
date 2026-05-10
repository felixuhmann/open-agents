# Todos

Future v1.x / v2 ideas. The v1 milestone is "single-tenant, admin-driven
agent platform with web chat + email"; everything below is out of scope
for that.

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

## Error reporting from email (v1.x)

Add a "report a problem" link to outbound email footers. Clicking it
opens a pre-filled report page (run id, agent id, conversation id) the
user can annotate and submit. Reports land in a `Report` table that
admins can triage from `/settings/reports`. Optionally fan out to a
webhook (Slack, PagerDuty, Linear).

## Email disclaimers (v1.x)

Footer paragraph in outbound mail warning users that agents can make
mistakes and not to send PII. Editable per-deployment from
`/settings/general`.

## Skill bundle hot-rebind (v1.x)

`/library/skills` currently models bundles as immutable: editing a
skill is "delete + re-upload". Live rebind would store new versions
alongside the old and let admins flip the active version per agent.

## User code sandbox tool (v2)

Let admins author small JS/TS snippets in the UI that get exposed as
MCP tools. Run in an isolated VM2-style sandbox with a curated subset of
APIs. Replaces the "I need a custom thing, write me a third-party MCP
server" workflow for the simple case.

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

## Per-agent Mailgun route auto-provisioning

Today the operator wires up one catch-all route per deployment. Mailgun
has an API we could use to manage routes, but the catch-all handles
every agent so this isn't on the path. Skip it.

## Cross-thread continuation between email and web chat

Out of scope and likely to stay that way. Different surfaces, different
permission models, ambiguous threading semantics.
