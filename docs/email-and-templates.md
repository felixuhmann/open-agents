# Email & templates

Everything between Mailgun and the user lives here: how inbound mail
gets parsed, how threading is preserved across replies, how the agent's
Markdown becomes a branded HTML email, and where the static assets live.

> Email is **one of two surfaces** for an agent in v1; the other is web
> chat. They share the run-agent worker and the `RunEvent` log but never
> share state. Email is opt-in per-agent (`Agent.emailEnabled`).

## Inbound

### Webhook contract

Mailgun POSTs `multipart/form-data` to `POST /mailgun/inbound` (note the
**no path parameter** — there is exactly one route). Fields we care about:

| Mailgun field    | Used as                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| `sender`/`from`  | `EmailThread.userEmail`                                                             |
| `recipient`/`To` | parsed → `Agent.inboundLocalPart` (resolves agent) and `EmailThread.inboundAddress` |
| `subject`        | `EmailThread.subject`                                                               |
| `Message-Id`     | dedupe + threading key                                                              |
| `In-Reply-To`    | thread lookup                                                                       |
| `References`     | thread lookup                                                                       |
| `stripped-text`  | preferred body (Mailgun strips quoted history)                                      |
| `body-plain`     | body fallback                                                                       |
| `attachment-N`   | one file per `attachment-1`, `attachment-2`, …                                      |
| `timestamp`      | HMAC verification                                                                   |
| `token`          | HMAC verification                                                                   |
| `signature`      | HMAC verification                                                                   |

[`apps/api/src/mailgun/parse.ts`](../apps/api/src/mailgun/parse.ts)
normalizes this into the `InboundEmail` shape;
[`apps/api/src/mailgun/verify.ts`](../apps/api/src/mailgun/verify.ts)
does the `HMAC-SHA256(timestamp+token, signing_key)` check using
`mailgun_signing_key` from the encrypted `Secret` table.

### Agent resolution

[`apps/api/src/routes/mailgun.ts`](../apps/api/src/routes/mailgun.ts):

1. Verify HMAC.
2. Parse the recipient address. The local part (everything before `@`)
   becomes the lookup key.
3. `getAgentByInboundLocalPart(localPart)` — DB lookup with the same
   in-process LRU cache used by `getAgentBySlug`.
4. If no match, log `mailgun inbound: agent not found` and return 200
   so Mailgun won't retry.
5. If found and `agent.emailEnabled = false`, log
   `mailgun inbound: email disabled` and return 200 + drop.
6. Otherwise hand off to `services/inbound.ts`.

### Threading model

We rely on standard email threading headers (`In-Reply-To`,
`References`) plus an agent-id scope so two agents can never share a
thread:

1. On every inbound, [`apps/api/src/services/threads.ts`](../apps/api/src/services/threads.ts):
   - Collects all candidate Message-Ids from `In-Reply-To` + `References`.
   - Looks up an `EmailThread` whose `rootMessageId` matches any of them
     (and whose `agentId` matches the resolved agent).
   - If not, looks up an `EmailMessage` whose `messageId` matches any of
     them (also scoped by `agentId`).
   - Otherwise creates a new thread rooted at this message.
2. The Anthropic `sessionId` is pinned on the `EmailThread`. As long as
   the thread is reused, the session is reused. New attachments force a
   fresh session (resources only mount at session-creation), and the
   new id replaces the old one.

### Attachments

Mailgun forwards attachment bytes inline in the webhook body. We
persist them immediately as `EmailAttachment` rows (Postgres `Bytes`)
inside the `services/inbound.ts` transaction so the worker can be
idempotent. The run-agent worker then:

- Calls
  [`uploadPendingAttachments`](../apps/api/src/services/attachments.ts),
  which uploads any rows missing `anthropicFileId` to the Anthropic
  Files API and writes `anthropicFileId` + `mountPath` back.
- Mounts them on a new session via
  `resources: [{ type: "file", file_id, mount_path }]`.

Inside the sandbox, Anthropic prefixes our `mount_path` with
`/mnt/session/uploads`. If your agent's prompt expects to read the file,
mention the absolute path explicitly.

## Outbound

### Building the reply

The send-email worker
([`apps/api/src/jobs/sendEmail.ts`](../apps/api/src/jobs/sendEmail.ts))
constructs a threaded reply:

- **`Subject:`** — `Re: <thread.subject>` unless it already starts with
  `Re:`.
- **`From:`** — `<displayName> <inboundAddress>`. `inboundAddress` is
  the address Mailgun received the first message on (captured in the
  thread). `inbound_from` from the `AppSetting` table is the last-resort
  fallback.
- **`In-Reply-To:`** — last inbound message-id on the thread.
- **`References:`** — every prior message-id on the thread, in order.
  This is what Gmail/Outlook use to thread the reply with the original.
- **Body** — agent's final aggregated assistant text (read from
  `AgentRun.output`, populated by the run-agent worker) rendered through
  [`AgentResponseEmail`](../apps/api/src/emails/AgentResponse.tsx).
- **Attachments** — every `AgentAttachment` row associated with the
  current `runId`.

After Mailgun confirms the send, we persist a row in `EmailMessage`
with `direction = "outbound"` so the next inbound webhook in the same
thread can resolve the thread by `In-Reply-To`/`References`.

### React Email templates

Templates live in [`apps/api/src/emails/`](../apps/api/src/emails/).
Today there's a single template:

- [`AgentResponse.tsx`](../apps/api/src/emails/AgentResponse.tsx) —
  branded layout with header (agent display name and optional avatar),
  Markdown body, and footer with the deployment logo. The Markdown is
  rendered through `react-email`'s `<Markdown>` component, which emits
  email-safe inline styles.

[`apps/api/src/services/renderEmail.ts`](../apps/api/src/services/renderEmail.ts)
wraps `render(...)`, extracts a 120-char preheader, and resolves the
agent avatar URL.

The footer also includes a "Report this conversation" link when the
caller passes `threadId` + `recipientEmail` (the send-email worker
always does). The link points at the public `GET /issues/report?token=…`
flow with an HMAC-signed token bound to the `EmailThread` and the
recipient address — see
[`apps/api/src/services/issueReportSigning.ts`](../apps/api/src/services/issueReportSigning.ts).
The recipient does **not** need a deployment account to file a report;
the signature is the credential. Submitted reports show up under
`/issues` in the SPA for admins to review.

### Per-agent profile picture

Each agent can pin a profile picture rendered in the email header (and
in the SPA agent list, detail page, and chat header). Upload it from
`/agents/<slug>/edit` → **Profile picture** → **Upload**:

1. The file is stored on disk under
   [`apps/api/data/uploads/avatars/`](../apps/api/data/uploads/) (a
   gitignored directory; mount a persistent volume here in production).
2. `Agent.avatar` records the public URL
   (`/static/uploads/avatars/<slug>-<random>.<ext>`); replacing or
   removing the picture deletes the old file in the same transaction.
3. Agents that leave the field empty fall back to the bundled
   `fallback.png`.

For backwards compatibility `Agent.avatar` also accepts a bare filename
inside [`apps/api/src/emails/static/`](../apps/api/src/emails/static/)
or an absolute `https://...` URL — the render service resolves all
three flavours to an absolute URL before handing it to
`AgentResponse.tsx`.

### Static assets

Two roots are served under the same `/static/...` URL prefix:

- **Bundled assets** —
  [`apps/api/src/emails/static/`](../apps/api/src/emails/static/) ships
  with the repo. Use this for the `fallback.png` and any other shared
  template images. **PNG/JPG only** for files in this folder — SVG/WEBP
  are unreliable in many email clients. The build copies the folder
  into `dist/emails/static/` so `node apps/api/dist/index.js` finds it.
- **Admin uploads** —
  [`apps/api/data/uploads/`](../apps/api/data/uploads/) holds files
  uploaded through the SPA (per-agent avatars under `avatars/`, the
  deployment footer logo under `footer/`). Gitignored; override the
  root with `STATIC_UPLOADS_DIR` if you want to point it at a mounted
  volume.

[`routes/static.ts`](../apps/api/src/routes/static.ts) mounts both:
`/static/uploads/*` resolves against the uploads dir, everything else
against the bundled dir. During `pnpm --filter @open-agents/api email`
react-email's preview server hosts the bundled folder at
`http://localhost:3001/static/<file>` (uploaded files aren't visible in
the preview — render the production app to see them).

In templates, switch the base URL on `NODE_ENV`:

```tsx
const baseURL =
  process.env.NODE_ENV === "production" ? (process.env.PUBLIC_BASE_URL ?? "") : "";

<Img src={`${baseURL}/static/your-logo.png`} alt="" width="120" height="40" />;
```

The `AgentResponse.tsx` template's footer logo is **not** hardcoded; it
reads from the `email_footer_logo_url` value under
**Settings → General** at send time. The settings page exposes both an
**Upload image** action (which writes to `data/uploads/footer/` and
sets the URL automatically) and a free-form URL field for absolute
`https://...` URLs you host elsewhere. Leave it empty to omit the image
entirely.

## Sandbox-uploaded attachments

The agent might _produce_ files (PDFs, spreadsheets, etc.) it wants
attached to the reply. The flow is identical for email **and** chat
runs:

1. The run-agent worker tells the agent how to return files:
   - **Anthropic managed agents:** a signed upload URL is injected:
     `REPLY_ATTACHMENT_UPLOAD_URL: https://<deploy>/runs/<runId>/attachments?sig=<hmac>`
     and the sandbox `POST`s `multipart/form-data` with a `file` field.
   - **Daytona backend:** the user message instructs the agent to call
     `attach_run_file` (orchestrator downloads from the sandbox via the
     Daytona API). Do not rely on `curl` to `PUBLIC_BASE_URL` from Daytona —
     sandboxes often cannot resolve that host.
     The "how/why/when to upload" instructions live in the agent's system
     prompt or attached skill; we only inject the dynamic hook.
2. Bytes land in `AgentAttachment` (direct `POST` or `attach_run_file`).
3. [`routes/upload.ts`](../apps/api/src/routes/upload.ts) verifies the
   HMAC, caps the size at 25 MB (Mailgun's per-message limit), and
   inserts an `AgentAttachment` row.
4. **Email surface:** the `send-email` worker queries `AgentAttachment`
   rows for the run and attaches each one to the outbound Mailgun
   message.
   **Chat surface:** the SPA's chat page calls
   `GET /api/runs/:runId/attachments` after the run terminates and
   renders each entry as a downloadable link
   (`GET /api/runs/:runId/attachments/:attachmentId`) on the assistant
   message bubble. Both endpoints are cookie-authenticated and scoped
   so only the conversation's owner (or an admin) can list/download.

The same `routes/upload.ts` module also accepts user-uploaded files for
chat conversations at `POST /conversations/:id/attachments`. That
endpoint uses the session cookie (no HMAC signature) — uploads land as
`ChatAttachment` rows on a placeholder `ChatMessage` with role
`pending_user_upload`. The next `POST /api/conversations/:id/messages`
call atomically reparents those attachments onto the real user message
inside a transaction and deletes the placeholders, so the run-agent
worker picks them up via `uploadPendingChatAttachments`.

Why HMAC instead of a session token: the sandbox has outbound HTTP but
no convenient way to surface a session-bound credential, and the upload
URL needs to be self-contained. The signature is HMAC-SHA256 of the run
id keyed by `UPLOAD_SIGNING_SECRET`. A leaked URL only allows posting
attachments to a known runId (itself a CUID), so the blast radius is
bounded.

## Things that have surprised people

- **One Mailgun route, no `:agentSlug`.** Old per-agent routes are dead.
  All inbound mail funnels through `POST /mailgun/inbound` and the agent
  is resolved by parsing the recipient.
- **Mailgun signing key vs API key.** The webhook signature is verified
  with `mailgun_signing_key` from `Secret` (separate from
  `mailgun_api_key`). Wrong key → every inbound webhook returns `401`.
- **Catch-all returns 200 even when dropped.** When the recipient
  doesn't match any agent or the agent has email disabled, we return
  200 so Mailgun won't retry forever. Logs are the only signal.
- **Outbound `From:` must match a real address Mailgun owns.** Otherwise
  user replies bounce. The thread's captured `inboundAddress` is the
  trusted source; the global fallback is a last resort for legacy data.
- **`stripped-text` vs `body-plain`.** We prefer Mailgun's
  `stripped-text` (no quoted history) and fall back to `body-plain`.
- **No HTML sanitization.** Agent output is treated as trusted content
  (same trust model as the prior plain-text pipeline). If you ever
  expose this to untrusted authoring, sanitize before rendering.
- **Email and chat are completely separate.** A user replying to an
  agent email cannot continue the conversation in `/agents/<slug>/chat`
  and vice versa.
