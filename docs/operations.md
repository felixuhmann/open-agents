# Operations

## Runs

Every chat or email turn creates an `AgentRun` and appends durable `RunEvent` rows. The SSE endpoint replays by sequence number and then switches to Postgres LISTEN/NOTIFY.

## OpenSandbox sandboxes

`AgentSandbox` tracks provider sandbox id, state, lifecycle policy, last activity, and links to the chat conversation or email thread. OpenSandbox lifecycle is pause/resume/kill plus a server-side TTL; the admin controls are stop (=pause), start (=resume), delete (=kill), sync, and reconcile. There is no archive and no recover. The reconcile worker periodically syncs provider state, pauses stale sandboxes, and clears pointers when provider sandboxes disappear.

## Attachments

User attachments are idempotent. Rows with `backendFileId` are skipped on retry; rows without it are uploaded and then mounted. Agent-created files come back through `attach_run_file` and are stored as `AgentAttachment`.

## Secrets

Rotate service credentials from Settings -> Secrets. Changing model-provider keys resets the in-process backend/key cache. The OpenSandbox runtime is env configuration, not a secret: changing `OPENSANDBOX_BASE_URL` or the other `OPENSANDBOX_*` vars requires an app restart to take effect. Plaintext secrets are never returned by the API.

## Debugging

Start with the run trace: `run.started`, sandbox lifecycle events, `tool.use`, `tool.result`, `model.request`, `session.error`, and terminal run events are all persisted. For sandbox issues, cross-check `AgentSandbox.state`, `lastActivityAt`, and provider sandbox id.
