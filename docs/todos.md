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

## Email disclaimers (v1.x)

Footer paragraph in outbound mail warning users that agents can make
mistakes and not to send PII. Editable per-deployment from
`/settings/general`.

## Skill bundle hot-rebind (v1.x)

`/library/skills` currently models bundles as immutable: editing a
skill is "delete + re-upload". Live rebind would store new versions
alongside the old and let admins flip the active version per agent.

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

## profile page
where users can reset their password, see how many sessions they made, etc

## new contributor role
currently we only have users and admins. we need a third role, someone wo is not responsible for managing the deployment, but still can create and edit agents and see usage statistics and handle error reports.

## analytics page
we need a analytics page where we can see usage statistics per agent, monthly token usage and spend, per model breakdown, per agent breakdown, error rate, avg time spent, etc etc etc. this should give the operators full observability into the usage, definitely a missing piece for real world usage. we can use shadcn charts here for some cool graphs.

## whitelabeling
we want to make the product name and favicon and the image in the sidebar configurable. the open-agents product should be white-lable able so people can make it custom to their org.

## support for new models
instead of anthropic only, we ideally also want to support gpt models and others. this will probably entail a large refactor of the product, as we need to use a different sandbox backend, currently we are heavily coupled to the anthropic solution.
