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
