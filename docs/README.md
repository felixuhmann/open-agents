# `docs/`

Developer & operator handbook for `open-agents`. Read top-down the
first time, dip into individual files later.

## Guides

| File                                               | When to read                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`architecture.md`](architecture.md)               | First. Explains data flow, the components, the layering rules, and the data model.                                                              |
| [`configuration.md`](configuration.md)             | When you're filling out `apps/api/.env` or wondering what an env var does (and which credentials live in the encrypted `Secret` table instead). |
| [`local-development.md`](local-development.md)     | Before you run `pnpm dev` for the first time. Covers the setup wizard, web chat loop, Mailgun tunnel loop, and the email preview server.        |
| [`deployment.md`](deployment.md)                   | Before you ship to Railway / any other Railpack-compatible host. Covers the single Mailgun catch-all route + Anthropic vault.                   |
| [`creating-agents.md`](creating-agents.md)         | Whenever you create or configure an agent in the UI. There is no longer any code path for adding agents.                                        |
| [`mcp-tools.md`](mcp-tools.md)                     | When you're authoring a new platform MCP tool (code-shipped handler) or debugging a tool the agent calls.                                       |
| [`email-and-templates.md`](email-and-templates.md) | When you're working on the inbound/outbound email path or editing react-email templates.                                                        |
| [`operations.md`](operations.md)                   | When something is broken in production and you need to figure out why.                                                                          |
| [`todos.md`](todos.md)                             | Future v1.x / v2 ideas explicitly out of scope for v1.                                                                                          |

## Other reference material

- [`../AGENTS.md`](../AGENTS.md) — repo conventions every code change
  must follow (ESM imports, layering, `pnpm check`). Single source of
  truth for "how do I write code in this repo"; everything in `docs/`
  is the _what_ and _why_.
- [`../packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma)
  — the database schema. Most fields carry a `///` doc comment.
- [`../README.md`](../README.md) — product context and quick start.

## Updating these docs

Treat them like code: when you change behavior, update the relevant
guide in the same PR. The "creating an agent" recipe in particular
drifts fast; bullet new gotchas there instead of rediscovering them
later. The project rule (`.cursor/rules/project.mdc`) requires docs to
be updated alongside code changes — the linter doesn't catch drift, but
PR review will.
