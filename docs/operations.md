# Operations

## Runs

Every chat or email turn creates an `AgentRun` and appends durable `RunEvent` rows. The SSE endpoint replays by sequence number and then switches to Postgres LISTEN/NOTIFY.

## Sandboxes

`AgentSandbox` tracks the provider, provider sandbox id, state, lifecycle policy, last activity, and links to the chat conversation or email thread. The reconcile worker periodically syncs provider state, stops stale sandboxes, and clears pointers when provider sandboxes disappear.

Every row dispatches through the provider recorded on it, so sandboxes created before a provider switch stay manageable. Reconciliation iterates over every configured provider and keeps going when one is unavailable, and a single unknown historical provider row fails on its own rather than failing the job.

Archive and recover are Daytona-only. Broker-backed rows report the action as unsupported, and Settings hides those buttons for them.

## Attachments

User attachments are idempotent. Rows with `backendFileId` are skipped on retry; rows without it are uploaded and then mounted. Agent-created files come back through `attach_run_file` and are stored as `AgentAttachment`.

## Secrets

Rotate service credentials from Settings -> Secrets. Changing `daytona_api_key` or model-provider keys resets the in-process backend/key cache. Plaintext secrets are never returned by the API.

The sandbox broker's token is deliberately **not** a `Secret` row: it authenticates one private container to another over a network the browser cannot reach, so it comes from `SANDBOX_BROKER_TOKEN` / `SANDBOX_BROKER_TOKEN_FILE` in the deployment environment and is never returned by any route. Rotating it means restarting the broker and the app.

## Debugging

Start with the run trace: `run.started`, sandbox lifecycle events, `tool.use`, `tool.result`, `model.request`, `session.error`, and terminal run events are all persisted. For sandbox issues, cross-check `AgentSandbox.provider`, `state`, `lastActivityAt`, and provider sandbox id. **Settings -> Sandboxes** reports each provider's live availability and the reason when one is unusable.
