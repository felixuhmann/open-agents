# Proposal: replace the `memory` platform tool with mounted memory stores

Status: **Draft / RFC.** Not implemented. Authored as a follow-up to the
v1.5 "per-collection memory schemas" entry in [`todos.md`](todos.md) after
the team flagged that the current memory primitive is too narrow and too
specific to one runtime category.

## TL;DR

Recommendation: **stop modelling memory as a custom CRUD MCP tool. Model
it as a workspace-scoped, mountable file directory** — the same primitive
Anthropic Managed Agents, Letta (MemFS), and Claude Code (CLAUDE.md /
MEMORY.md) all converged on in 2026.

Memory becomes:

- A new `AgentMemoryStore` row (per agent — or shared across agents in
  the same deployment) that owns a tree of small text/JSON/markdown
  files.
- On the Anthropic backend, the store is pushed to
  `client.beta.memory_stores.*` and attached via the session
  `resources[]` array. The agent reads/writes it under
  `/mnt/memory/<store-name>/` with the `read` / `write` / `edit` /
  `glob` / `grep` / `bash` tools it already has — there is no dedicated
  memory tool.
- On the Daytona backend, the store is materialized into
  `<workspaceDir>/.agents/memory/<store-name>/` on sandbox creation
  (mirrors `materializeAgentSkills`) and sync'd back to Postgres on
  session teardown / on demand via a tiny `memory_sync` hook.
- `MemoryDoc` + the six `memory_*` MCP tools (`memory_collections`,
  `memory_create`, `memory_read`, `memory_list`, `memory_update`,
  `memory_delete`) go away.

Secondary recommendation: **collapse the tool runtime taxonomy from
three categories to two.** `managed` stays as-is (toolset members
executed by the backend); `platform` and `AgentThirdPartyMcp` merge into
a single `mcp` category with a `provenance` flag (`builtin` /
`registry` / `custom`). Built-in MCP servers are still code-shipped and
still served from `/mcp/<slug>`; they're just no longer a separate
runtime concept. This is what the user request "move it into the mcp
category" maps to once memory itself stops being an MCP-CRUD tool.

The rest of this doc walks through the current state, surveys what
other agents are doing in 2026, and lays out three implementation
options ranked by fit for this codebase.

## What we have today

### The data model

```prisma
model MemoryDoc {
  id         String   @id @default(cuid())
  agentId    String
  collection String   // free-form, case-sensitive, no normalisation
  doc        Json     // free-form JSON document
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  agent      Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
}
```

### The tool surface

Six tools shipped from `apps/api/src/mcp/platform/memory.ts`:

| Tool                 | Shape                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `memory_collections` | `() → { collections: { name, count }[] }`                                |
| `memory_create`      | `(collection, doc) → { id, collection, createdAt }`                      |
| `memory_read`        | `(id) → { id, collection, doc, createdAt, updatedAt }`                   |
| `memory_list`        | `(collection, filter?: {field: scalar}, limit, cursor) → { items, next }` |
| `memory_update`      | `(id, doc) → { id, updatedAt }`                                          |
| `memory_delete`      | `(id) → { ok }`                                                          |

### Known limitations

These come straight out of the code, the doc, and the v1.5 todo entry:

1. **Free-form, case-sensitive collection names.** The handler itself
   warns about `guest_list` vs `guestlist` silently being two different
   stores. The mitigation is "call `memory_collections` first" — i.e.
   one mandatory extra round-trip every time the agent forgets where it
   put something.
2. **No schema.** Every doc is `Json`. The v1.5 todo proposes adding
   per-collection Zod schemas.
3. **No semantic search.** Only flat top-level equality filter.
4. **No full-text search.** Not even `LIKE`.
5. **No versioning / audit / rollback.** Updates are destructive.
6. **No read-only / shared-reference mode.** Every doc the agent can
   read, it can also clobber.
7. **Five tool descriptions** to learn (`_create`, `_read`, `_list`,
   `_update`, `_delete`) for what is conceptually one capability. Each
   description is ~prompt-engineering surface that has to stay in sync.
8. **Runtime-specific.** The tool exists as a `platform` MCP handler;
   Anthropic's native filesystem tools (`read`, `write`, …) and Daytona
   sandboxes both have full filesystems that go unused for memory.
9. **No deduplication, no consolidation, no temporal tracking.** Two
   agent turns can write the same fact twice with no way to merge.

None of these are fatal — agents do use this — but together they make
the primitive feel narrow, and adding fixes one-at-a-time will keep
it MCP-CRUD-shaped forever.

## How other agents implement persistent memory in 2026

Quick survey of what the 2026 ecosystem actually ships. Sources and
URLs at the bottom of the doc.

### Filesystem-backed (the converging winner)

- **Anthropic Managed Agents — memory stores.** A `memstore_…` is a
  workspace-scoped directory of small text files (≤ 100KB each).
  Attach to a session via `resources[]` with `access: read_write` or
  `read_only`; Anthropic FUSE-mounts it at `/mnt/memory/<store-name>/`
  and the agent reads/writes it with the **standard file tools**.
  Every write produces an immutable `memver_…` (audit + rollback).
  Up to 8 stores per session. Description + instructions are
  auto-injected into the system prompt.
- **Letta MemFS.** Letta migrated away from "memory blocks via tool
  calls" (the original MemGPT design) to a git-backed filesystem of
  markdown files in 2026 (`~/.letta/agents/<id>/memory`). Files under
  `system/` always load into the prompt; everything else is visible
  via the directory tree but lazy-loaded. The agent edits with bash
  tools, commits, optionally pushes back to Letta Cloud. A
  background "sleep-time reflection" subagent rewrites memory in a
  separate worktree and merges on completion.
- **Claude Code — CLAUDE.md / MEMORY.md.** A handful of well-known
  paths (`./CLAUDE.md`, `~/.claude/CLAUDE.md`, `./.claude/rules/*.md`,
  auto-memory under `~/.claude/projects/.../memory/MEMORY.md`). First
  ~200 lines always load; the rest is on-disk and on-demand. Heavy
  emphasis on "keep it short or the model stops following it."

The common thread: **memory is just files**, and the agent uses the
same `read`/`write`/`edit`/`grep`/`glob`/`bash` tools it already has.
No dedicated memory tools. The harness owns mounting, versioning, and
ACLs.

### Tool-call-based (MemGPT-classic / Letta v0 / MCP servers)

- **MemGPT / Letta v0 (still relevant).** Three tiers — core (always
  in prompt), recall (conversation history search), archival (vector
  DB). Tools: `core_memory_append`, `core_memory_replace`,
  `archival_memory_insert`, `archival_memory_search`,
  `conversation_search`. The agent is responsible for moving items
  between tiers, which makes it more autonomous but also a lot more
  expensive per turn.
- **Generic MCP memory servers** (`shodh-memory`, agent-memory-mcp,
  many others). Expose `remember(key, value)` / `recall(query)` /
  `search_memories` / `forget(key)` / `proactive_context` over MCP.
  Add namespaces, TTLs, hybrid search (vector + full-text), sometimes
  embedded vector indexes (e.g. RocksDB + ONNX). Closest in spirit to
  what we ship today.

### Fact-extraction layer

- **mem0.** Background pipeline that extracts atomic facts from each
  conversation turn (via the LLM), dedupes against existing memories
  in a vector store, and surfaces them on the next call. Agent
  doesn't manage memory at all — it's automatic. Lightweight, fits in
  front of any LLM call. Trade-off: facts get "interpreted" by an LLM
  before being stored, which makes the audit story weaker.

### Temporal knowledge graph

- **Zep / Graphiti.** Entities + relationships + bi-temporal validity.
  Best for "what did the user prefer in Q1 vs Q3" or "this fact was
  superseded on 2026-03-04". Heaviest infra (graph DB, embeddings),
  highest recall accuracy on contradictions-over-time benchmarks
  (`LongMemEval`).

### What this means for us

Three observations:

1. The **filesystem pattern won** in 2026. Anthropic shipped it
   natively, Letta migrated to it, Claude Code has shipped it from
   day one. This is the highest-leverage place to land.
2. The runtime we use most (Anthropic Managed Agents) **gives the
   filesystem primitive away for free** under the
   `managed-agents-2026-04-01` beta header — including versioning and
   audit. We are not using it.
3. Both of our backends (Anthropic + Daytona) **already advertise the
   exact set of tools needed to consume it** (`read`, `write`, `edit`,
   `glob`, `grep`, `bash`). Our current `memory_*` tools duplicate a
   subset of that capability against a worse storage substrate.

## Recommended approach: mounted memory stores

### High-level shape

```
                                  ┌──────────────────────────────┐
                                  │ AgentMemoryStore (Postgres)  │
                                  │  id, slug, name, description │
                                  │  scope: agent | deployment   │
                                  │  defaultAccess: rw | r       │
                                  │  agentId? deploymentId?      │
                                  └──────────────┬───────────────┘
                                                 │
                  ┌──────────────────────────────┴────────────────────────────┐
                  │                                                           │
        Anthropic Managed Agents                                  Daytona / Pi sandbox
                  │                                                           │
   sync push → client.beta.memory_stores                materialize → <workspaceDir>/.agents/memory/<slug>/
   attach → session.resources[]: memory_store                       (mirrors materializeAgentSkills)
                  │                                                           │
   FUSE mount at /mnt/memory/<slug>/                       file watcher / explicit sync hook
                  │                                                           │
                  └────────────── agent uses read / write / edit / grep / glob / bash ───┘
```

### Object model

```prisma
model AgentMemoryStore {
  id              String   @id @default(cuid())
  /// URL-safe slug (a-z0-9_-). Becomes the mount directory name.
  slug            String
  name            String
  /// Free-form prose written for the model (gets injected into the
  /// system prompt when the store is mounted).
  description     String
  /// Optional default access mode for new mounts. Per-binding override below.
  defaultAccess   String   @default("read_write")
  /// One of `agent` or `deployment`. Deployment-scoped stores can be
  /// bound by multiple agents (read-only by default).
  scope           String   @default("agent")
  agentId         String?  // when scope=agent
  agent           Agent?   @relation(fields: [agentId], references: [id], onDelete: Cascade)
  // ... timestamps, etc.

  files           MemoryFile[]
  bindings        AgentMemoryStoreBinding[]
  versions        MemoryFileVersion[]

  @@unique([scope, slug])
  @@index([agentId])
}

model MemoryFile {
  id        String  @id @default(cuid())
  storeId   String
  /// POSIX-style path inside the store; "/notes/2026-03/onboarding.md".
  path      String
  /// Text content (≤ 100 KB; bigger goes in object storage with a hash).
  content   String
  sha256    String
  store     AgentMemoryStore @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, path])
  @@index([storeId])
}

model MemoryFileVersion {
  id         String   @id @default(cuid())
  storeId    String
  fileId     String?  // null if the path was deleted
  path       String
  contentSha String
  /// Snapshot of bytes at this version (could be off-loaded to object storage).
  content    String?
  operation  String   // created | modified | deleted
  actorType  String   // session | api | user
  actorId    String
  createdAt  DateTime @default(now())
  store      AgentMemoryStore @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId, path, createdAt])
}

model AgentMemoryStoreBinding {
  id            String @id @default(cuid())
  agentId       String
  storeId       String
  /// "read_write" or "read_only" — overrides AgentMemoryStore.defaultAccess
  access        String
  /// Optional per-binding mount instructions injected into the system prompt
  /// in addition to the store description.
  instructions  String?
  agent         Agent            @relation(fields: [agentId], references: [id], onDelete: Cascade)
  store         AgentMemoryStore @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([agentId, storeId])
}
```

`MemoryFile` is the canonical state; `MemoryFileVersion` is the audit
log; `AgentMemoryStoreBinding` is the per-agent mount declaration.
Three tables replace the current one, but the **agent-facing surface
is no MCP tools at all** — they just see a directory.

### Anthropic backend

Already mostly free. The store-shaped object on Anthropic's side already
exists; we'd sync from `AgentMemoryStore` → `memstore_…` lazily (on
first session that binds the store) and attach via
`session.resources[]` when the worker calls `createSession`. Writes that
the agent makes through `/mnt/memory/<slug>/` come back to us through
Anthropic's `memver_…` audit log; we mirror those into
`MemoryFileVersion` for cross-backend continuity. Existing forced-new-
session logic for resources still applies — that's already wired in the
run-agent worker.

### Daytona backend

`createSession` already calls `materializeAgentSkills` to unpack skill
bundles into `<workspaceDir>/.agents/skills/<slug>/`. Add a sibling
`materializeAgentMemory` that writes every `MemoryFile` for each bound
store into `<workspaceDir>/.agents/memory/<slug>/`. The system prompt
gets a short note pointing the agent at the directory (parallel to the
"Skills" block already produced by `daytona.ts`).

Two ways to sync writes back:

1. **Tail-on-tool-output (easy).** When the bash/write/edit tools touch
   anything under `.agents/memory/<slug>/`, queue a delta sync. We
   already stream `tool.output` events from the sandbox; the path
   prefix check is cheap.
2. **Explicit `memory_sync` host-side MCP tool (safer).** Single tool
   the agent calls "when you finish updating memory, call
   `memory_sync()`". Slower, but bulletproof against streaming bugs.

I'd ship (2) first and add (1) opportunistically. (Either way, there's
no per-doc MCP tool — sync is invisible to the agent on the happy
path, and only surfaces if the agent wants to flush early.)

### What the agent sees

- A new system-prompt block (auto-generated):
  ```
  ## Memory
  You have the following persistent memory stores mounted:

  - `/mnt/memory/preferences/` (read_write)  Per-user preferences and
    project context. Check before starting any task.
  - `/mnt/memory/playbooks/` (read_only)  Shared playbooks for
    handling support tickets.
  ```
- A real directory under `/mnt/memory/` (Anthropic) or
  `.agents/memory/` (Daytona). The agent runs `ls`, `grep -r`,
  `cat`, `rg`, `glob`, `read`, `write`, `edit` against it — same
  tools, same muscle memory, same prompt patterns it already uses
  for source files.

The collection-name footgun disappears: the agent literally `ls`s the
directory. There is no "lookup the right name first" round-trip.

### Migration

- One-shot job that translates each existing `MemoryDoc` row into a
  `MemoryFile` at path
  `/<collection>/<docId>.json` containing `JSON.stringify(doc.doc)`.
  Two collections that differ only in casing collide cleanly into a
  single directory; the migration emits a warning.
- The six `memory_*` tools stay catalog-registered as `deprecated:
  true` for one release so existing agents don't break — they keep
  reading the same `MemoryDoc` table during the transition. Drop after.
- Existing agent system prompts that say "use `memory_create` …" get
  flagged in the agent edit page UI with an inline migration hint.

## Alternatives I considered

### Alternative B — Smarter MCP memory server (Mem0-shaped)

Replace the six CRUD tools with three semantic tools:

- `memory_remember(text, namespace?, ttl?)`  store a fact.
- `memory_recall(query, k=5, namespace?)`  hybrid (vector + FTS)
  search.
- `memory_forget(id | query)`  delete.

Backed by Postgres + pgvector + an embedding worker that runs after
each agent turn to extract atomic facts. Pulls in `pgvector` and an
embedding dependency.

Pros: catches the "the agent should not have to remember to remember"
case; semantic search is genuinely useful.

Cons: doesn't unify across backends — still an MCP tool. Worse audit
story (LLM-rewritten facts). Embeddings infra is a new operational
load. Doesn't capture the "shared playbook" / "read-only reference"
use-case as naturally as a mounted directory.

Verdict: a **good complement** to (A), not a replacement. If we ever
want semantic recall, ship it as a managed MCP tool *on top* of the
filesystem — the source of truth still lives in files.

### Alternative C — Just patch what we have

Implement the v1.5 todo (per-collection Zod schemas), normalize
collection names, add a `memory_search` tool with Postgres FTS over
the JSON doc.

Pros: minimal change. Cons: doesn't make memory more **general
purpose**; it sharpens an already-narrow primitive. Still one runtime
category isolated from the rest of the tool surface. Recommend against
unless we explicitly don't want to spend the effort on (A).

## Secondary proposal — collapse `platform` and `third-party MCP` into one `mcp` category

This addresses the user's "move it into the mcp category" framing
directly, independent of which memory approach we pick.

### Today

Three categories in three different tables:

| Concept     | Source                            | Where it lives                                          |
| ----------- | --------------------------------- | ------------------------------------------------------- |
| `managed`   | `Tool.runtime = "managed"`        | Anthropic's container; we don't run code                |
| `platform`  | `Tool.runtime = "platform"`       | Our `apps/api/src/mcp/platform/*.ts`; served at `/mcp/<slug>` |
| third-party | `AgentThirdPartyMcp`              | Admin-supplied URL; not in the `Tool` catalog at all    |

`managed` and `platform` share a row shape (`Tool` + `AgentToolBinding`);
third-party MCPs are a separate table and a separate code path in
`anthropic/provisioning.ts` and `mcp/piTools.ts`. There are also some
half-built UI surfaces ("Library → MCP" deployment-wide catalog) hinting
at where this is going.

### Proposed

```
Tool.runtime ∈ { managed, mcp }
```

`managed` keeps its meaning. **Everything that speaks MCP becomes
`mcp`** — built-in handlers, deployment-installed servers from a
registry, and admin-supplied custom URLs all live in the same row
shape, distinguished by a `provenance` column (`builtin` | `registry`
| `custom`) and an optional `serverUrl` (null for `builtin` since we
serve them ourselves at `/mcp/<slug>/builtin/<key>`).

Concretely:

- `AgentThirdPartyMcp` is dropped; its rows migrate into `Tool` with
  `runtime = "mcp"`, `provenance = "custom"`, `serverUrl = ...`.
- `PLATFORM_HANDLERS` keeps existing in code, but each handler becomes
  a `Tool` row with `runtime = "mcp"`, `provenance = "builtin"`,
  `key = handler.key`. The publish-time translator in
  `anthropic/provisioning.ts` builds the `mcp_servers` block from
  `runtime = "mcp"` rows of any provenance.
- The agent edit UI shows one section ("MCP") instead of two ("Tools"
  + "Custom MCP servers"). Built-ins float to the top of the picker
  with a small `Built-in` chip; everything else is alphabetical.

This is the simplest tax we can pay to make the v1.x "Library → MCP"
deployment-wide catalog feel coherent: a single list of MCP servers,
some of which happen to be shipped in the repo.

It also makes the **memory recommendation cleaner**: if you go with
(A), memory stops being an MCP tool entirely — it's a `resources[]`
mount on the agent backend side. If you go with (B) or (C), memory
stays MCP but lives in the unified `mcp` category instead of the
special-cased `platform` one.

## Risks and open questions

- **Daytona sync semantics.** The "tail tool output" sync path is
  cute but could miss writes that happen via `bash` rather than the
  managed `write` / `edit` tools. The explicit `memory_sync` tool is
  the only correct version for that backend; the UX of the agent
  remembering to call it is the question. (Mitigation: emit it as a
  reminder in the system prompt and call it automatically on session
  close.)
- **Store size.** Anthropic caps individual memory files at 100 KB.
  Letta keeps everything in git, with topic files split out from
  `MEMORY.md`. We should pick a soft cap (suggest 256 KB per file,
  off-load > 256 KB to object storage with a hash + path indirection)
  and a hard cap per store (Anthropic enforces upstream; we should
  match).
- **Cross-store and cross-agent sharing.** The proposed model lets
  one store be bound by multiple agents (with per-binding access
  mode). Worth deciding now whether deployment-scope stores are part
  of v1 or punted to v1.5.
- **PII / secrets.** Anthropic supports `memver` redaction; we should
  surface that in the admin UI from day one — leaked secrets in
  memory are a likely incident class.
- **What happens to existing agents at upgrade time.** The deprecated
  `memory_*` tools need to stay live for one release. We don't ship
  the new "Memory" agent-edit-page section as default-on; admins opt
  in per agent until the migration job has run.

## References

- Anthropic Managed Agents — memory stores skill:
  [`/.agents/skills/claude-api/shared/managed-agents-memory.md`](../.agents/skills/claude-api/shared/managed-agents-memory.md).
- Anthropic public docs: https://platform.claude.com/docs/en/managed-agents/memory.
- Letta MemFS: https://docs.letta.com/letta-code/memfs.
- Letta vs Mem0 vs Zep comparison (2026): https://apiscout.dev/guides/zep-vs-mem0-vs-letta-agent-memory-api-2026.
- Mem0 architecture (extract → dedupe → vector store): https://aiworkflowlab.dev/article/agent-memory-mem0-vs-letta-vs-zep-2026.
- Zep / Graphiti temporal knowledge graph: https://www.getzep.com/.
- MCP memory servers landscape: https://www.shodh-memory.com/blog/mcp-memory-server-guide.
- Claude Code memory (CLAUDE.md / MEMORY.md): https://code.claude.com/docs/en/memory.
