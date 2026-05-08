# Operations

How to read the logs, where retries come from, and how to debug a run
that went sideways.

## Logging

Structured JSON Lines on stdout/stderr via
[`apps/api/src/log.ts`](../apps/api/src/log.ts). `info` and `debug` go
to stdout; `warn` and `error` go to stderr.

Every line has `t` (ISO timestamp), `level`, and `msg`. Everything else
is per-event metadata. The structured logger is the **only** place
stdout writes are deliberate — `console.log` from anywhere else is
forbidden by ESLint.

### Correlation ids

Stitch events across the pipeline with these:

- **`reqId`** — short request id assigned by the request-log
  middleware. Every HTTP-handling line carries it.
- **`agentId`** — `Agent.id`. Stamped on logs from the moment the route
  resolves the agent.
- **`runId`** — `AgentRun.id`. Stamped on every run-agent / send-email
  line.
- **`sessionId`** — Anthropic session id. Logged once
  `sessions.created` / `sessions.resumed` runs.
- **`conversationId`** — `ChatConversation.id`. Stamped on every
  chat-surface log line.
- **`threadId`** — `EmailThread.id`. Stamped on every email-surface log
  line.

Grep for the highest-precision id you have. A typical successful chat
turn (only the most useful lines shown):

```
http: request start                       reqId=abc12345 path=/api/conversations/cv_…/messages
http: request done                        reqId=abc12345 status=200 durationMs=…

http: request start                       reqId=def67890 path=/api/runs/run_…/events
run-events: LISTEN established
run-agent: start                          jobId=… runId=run_… surface=chat
sessions: resuming chat conversation      conversationId=cv_… sessionId=sess_…
run-agent: done                           runId=run_… durationMs=…
```

(`RunEvent` rows are written silently inside the worker — there is no
per-event log line. Inspect the table directly to see them; see
**Run events** below.)

A typical successful email round-trip:

```
http: request start                       reqId=… path=/mailgun/inbound
mailgun inbound: parsed                   reqId=… agentSlug=helper from=user@example.com subject=… messageId=<…>
inbound: thread resolved                  reqId=… agentSlug=helper threadId=thr_…
inbound: enqueued run-agent               reqId=… threadId=thr_… runId=run_…
http: request done                        reqId=… status=200 durationMs=…

run-agent: start                          jobId=… runId=run_… surface=email
attachments: uploaded                     runId=run_… fileId=file_… mountPath=/workspace/inbox/…
sessions: created email                   threadId=thr_… sessionId=sess_…
run-agent: done                           runId=run_… durationMs=…
send-email: start                         runId=run_… threadId=thr_…
send-email: prepared                      runId=run_… subject=Re:… bodyChars=…
send-email: done                          runId=run_… mailgunId=<…>
```

### "Scanner noise"

The request-log middleware classifies anything outside the registered
route prefixes as scanner noise (`/.env`, `/wp-admin`, etc.) and emits a
single `http: scanner 404` warning per request rather than a full
start/done pair. Don't try to make these go away by adding routes;
filter them in your aggregator instead.

## Run events

Web chat replays from the durable `RunEvent` log. To inspect what
actually happened during a run, the Postgres table is the source of
truth:

```sql
SELECT seq, type, payload->>'toolName' AS tool_name, "createdAt"
  FROM "RunEvent"
 WHERE "runId" = 'run_…'
 ORDER BY seq;
```

Event types worth knowing:

| Type            | Payload shape                                  |
| --------------- | ---------------------------------------------- |
| `run.started`   | `{}`                                           |
| `agent.message` | `{ text }` — running aggregated assistant text |
| `agent.delta`   | `{ delta }` — char-by-char delta (optional)    |
| `tool.use`      | `{ toolName, args }`                           |
| `tool.result`   | `{ toolName, result, isError? }`               |
| `session.error` | `{ message }` — non-fatal session warning      |
| `run.succeeded` | `{}`                                           |
| `run.failed`    | `{ error }`                                    |

Terminal events (`run.succeeded` / `run.failed`) close the SSE stream.

## Retries

### pg-boss

Both job queues use pg-boss's default retry behavior. A worker handler
that throws causes the job to be retried (with backoff) up to the
queue's retry limit, after which it lands in the failed-jobs table.

The canonical worker pattern in
[`runAgent.ts`](../apps/api/src/jobs/runAgent.ts) wraps the handler in a
try/catch that:

1. Logs `run-agent: failed` with full stack and context.
2. Marks `AgentRun.status = "failed"` and emits a `run.failed`
   `RunEvent` so any subscribed SSE client sees the terminal event.
3. Re-throws so pg-boss knows the job didn't succeed.

If you write a new worker, follow the same shape exactly. Bare `throw`
from a handler makes pg-boss retry silently with no DB trace.

### Mailgun webhook

Mailgun retries `5xx` responses on the inbound webhook for a few hours
on its own backoff. The inbound flow is **idempotent by design**:

- `services/inbound.ts` looks up the `EmailMessage` by `messageId`
  before doing anything. If it's already there, the call is a no-op
  and we return `200`.
- `services/attachments.ts` only uploads rows missing
  `anthropicFileId`. Re-runs of the worker after a partial-upload
  crash pick up where they left off.
- The catch-all returns 200 (with a logged drop) for unrecognized
  recipients, so Mailgun doesn't retry mail to a deleted agent forever.

### Anthropic streaming

`AnthropicAgentBackend.streamUntilIdle` opens the SSE stream **before**
sending the user message so we don't miss early events. We break out of
the loop on:

- `session.status_idle` with `stop_reason.type ∈ {"end_turn", …}` —
  normal success path. The last `agent.message` text becomes
  `AgentRun.output`.
- `session.status_idle` with `stop_reason.type === "retries_exhausted"`
  — throw `AgentBackendError`, bubble up to the worker's try/catch,
  marked failed.
- `session.status_idle` with `stop_reason.type === "requires_action"`
  — defensive `continue`. Keeps the stream open in case a future tool
  surface starts triggering it.
- `session.status_terminated` — return whatever output we have so far.

`session.error` events are logged but **non-fatal** — for example, MCP
auth failures surface there but the session keeps running. So expect to
see them sometimes even on otherwise-successful runs.

## How to debug

### Web chat: "I sent a message but the page is silent"

1. **Was the message accepted?** Look at the `http: request done`
   line for `POST /api/conversations/:id/messages` — should be
   `status=200`. If not, the SPA shows the error inline.
2. **Did the SSE handler open?** A subsequent `http: request start`
   for `GET /api/runs/:runId/events` should appear. If not,
   EventSource never connected — proxy/firewall problem.
3. **Is the LISTEN connection alive?** A single
   `run-events: LISTEN established` line is logged when the first
   subscriber attaches. `run-events listener error` indicates the
   dedicated `LISTEN` connection died — restart fixes it.
4. **Did the worker pick the job up?** `run-agent: start` with the
   same `runId`. No worker → check `pg-boss started` on boot.
5. **Did the run finish?** `run-agent: done` for success, or
   `run-agent: failed` (with `err` and `durationMs`) for failure.
   The DB-level `RunEvent` rows are the canonical event trail —
   query them directly (see **Run events** below).

### Email: "I sent an email and nothing happened"

1. **Mailgun got it?** Check the Mailgun _Logs_ tab for the recipient
   address. If it never appears, your DNS / inbound route is the
   problem.
2. **Webhook delivered?** Mailgun's log shows the webhook delivery
   attempt and the response status. `401` ⇒ signing key mismatch
   (`mailgun_signing_key` in `Secret`). `5xx` ⇒ check our logs.
3. **Backend received it?** Search logs for `mailgun inbound: parsed`
   or `mailgun inbound: signature mismatch`. If neither, the request
   never reached the app — check tunnel / load balancer.
4. **Agent resolved?** Look for `mailgun inbound: parsed` carrying
   the `agentSlug`. If you see
   `mailgun inbound: no agent for recipient` instead, the local-part
   doesn't match any `Agent.inboundLocalPart`. Edit the agent's
   inbound local-part to match.
5. **Agent has email enabled?** A logged
   `mailgun inbound: email disabled for agent` means the agent
   exists but `emailEnabled = false`. Toggle it back on from the
   edit page.
6. **Job enqueued?** `inbound: enqueued run-agent` should appear with
   the `runId`. If you see `inbound: duplicate message, ignoring`,
   the `messageId` is already in `EmailMessage` — Mailgun retried a
   webhook we already processed. That's expected.
7. **Worker picked it up?** `run-agent: start` with the same `runId`.
8. **Did the run succeed?** `run-agent: done` ⇒ then look for
   `send-email: start`.
9. **Did Mailgun accept the outbound?** `send-email: done` carries the
   `mailgunId`. Check Mailgun _Logs_ for that id.

### "The agent ran but the reply is wrong / missing"

- **Empty body**: `send-email: prepared` shows the `body` length (also
  visible from `run-agent: done`'s `outputChars`). 0 chars ⇒ the agent
  didn't emit a final `agent.message` event before idling. The worker's
  fallback ("(The agent produced no textual output for this turn.)")
  will be used.
- **Missing attachments**: search the `runId` for `upload: stored`
  events. If none, the sandbox didn't post anything to the signed URL
  — usually a prompt-engineering issue (the agent didn't realize it
  should upload). Confirm by searching for `upload: bad signature` or
  `upload: unknown run`.
- **Wrong tool calls**: every `RunEvent` of `type = tool.use` records
  the tool name and args. Cross-reference with the agent's bound tools
  from the edit page.

### "MCP tool calls are failing"

- `mcp: unauthorized` ⇒ vault credential's bearer doesn't match
  `MCP_AUTH_TOKEN`. Either update the env and restart, or update the
  vault credential.
- `mcp: unknown agent` ⇒ slug mismatch. Confirm the URL in the
  published Anthropic agent's `mcp_servers` matches the local
  `Agent.slug`. Re-publishing fixes drift after a slug change (don't
  rename slugs in production).
- `mcp tool error` ⇒ a tool handler threw. The `err` field is the
  message. Look upstream for the actual root cause; the handler should
  log richer context if it's something domain-specific.

### "`run-agent` keeps retrying the same job"

It's marked `AgentRun.status = "failed"` and pg-boss is retrying. Look
for `run-agent: failed` lines for the root cause. If it's a permanent
failure (deleted agent, missing publish, etc.), kill the queued job
manually. There's no built-in dead-letter UI; query the `pgboss.job`
table directly:

```sql
SELECT id, name, state, retrycount, output FROM pgboss.job
 WHERE name = 'run-agent' AND state IN ('retry', 'failed')
 ORDER BY createdon DESC LIMIT 50;
```

Use `UPDATE pgboss.job SET state = 'cancelled' WHERE id = '…';` to stop
retries.

## Health checks

- `GET /health` — `200 OK` immediately. Use for liveness.
- `GET /health/ready` — runs a `SELECT 1` against the DB. Use for
  readiness.

If `/health` is good but `/health/ready` is bad, Postgres is the
problem. If both are bad, the process is wedged or not bound to the
port — check the bootstrap log lines.

## Skill bundles

Skill bundles uploaded from `/library/skills`:

- The zip is stored locally under
  `data/skills/<timestamp>-<sanitized-name>.zip` (the directory is
  configurable via `SKILL_BUNDLE_DIR`). The filename lives on
  `Skill.bundleStorageRef`.
- It's reflected to Anthropic via `POST /v1/skills`; the returned
  `id` + `version` go on the `Skill` row.
- Bumping a skill is "delete + re-upload" in v1; live rebinding lands
  later. The bundle directory is the canonical source of truth for
  the bytes — don't truncate it.

## Backups

Postgres holds everything that matters:

- email + run state (recoverable from Mailgun's archive in a pinch);
- attachment **bytes** (the only canonical copy);
- chat conversations and `RunEvent` log;
- agent definitions, bindings, secrets, memory.

Standard daily snapshots + point-in-time recovery are sufficient. Don't
truncate `EmailAttachment`, `RunEvent`, or `MemoryDoc` — nothing else
has the data.

The `data/skills/` directory on disk should also be backed up (or
mirrored to S3) since the zip bytes are not in Postgres. Same goes for
`data/uploads/` (admin-uploaded agent profile pictures + the
deployment footer logo); override either path with `SKILL_BUNDLE_DIR` /
`STATIC_UPLOADS_DIR` when mounting persistent volumes.

## Rotating secrets

| Secret                              | How to rotate                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_AUTH_TOKEN` (env)              | Update env, restart, then click **Publish** on every platform-bound agent so the publish flow PATCHes each vault `static_bearer.token`. Brief tool-call failures during the gap. |
| `UPLOAD_SIGNING_SECRET` (env)       | Update env, restart. Invalidates in-flight signed URLs (rare; runs are short).                                                                                                   |
| `BETTER_AUTH_SECRET` (env)          | Update env, restart. **All sessions are invalidated** — every user has to sign in again.                                                                                         |
| `SECRET_ENCRYPTION_KEY` (env)       | **Don't.** Requires a one-shot re-encrypt job (read-decrypt-with-old, encrypt-with-new) that doesn't exist in v1.                                                                |
| `anthropic_api_key` (DB)            | `/settings/secrets` → save new value. The Anthropic client picks it up on the next request.                                                                                      |
| `anthropic_vault_id` (DB)           | Same; resets the agent backend.                                                                                                                                                  |
| `mailgun_api_key` / `_domain` (DB)  | Same; the Mailgun client lazy-rebuilds.                                                                                                                                          |
| `mailgun_signing_key` (DB)          | Save the new key in `/settings/secrets` **before** flipping it on Mailgun's side; otherwise inbound webhooks `401` for the duration of the gap.                                  |
| Per-tool secrets (DB, scope `tool`) | Edit the tool binding on the agent edit page; the next MCP call sees the new value.                                                                                              |
