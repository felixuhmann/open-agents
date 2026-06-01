# Email and templates

Email is an optional surface for each agent. Mailgun posts inbound messages to `/mailgun/inbound`; the backend resolves the agent from the recipient local part and enqueues `run-agent`.

Inbound attachments are stored as `EmailAttachment` rows. On the next run, rows without `backendFileId` are uploaded to the agent backend and mounted into the Daytona sandbox under `/workspace/inbox/`.

Agent-created files are returned with `attach_run_file`. The orchestrator pulls bytes from the sandbox, stores `AgentAttachment` rows, and includes them in outbound email replies.

React Email templates live under `apps/api/src/emails/`. Branding and footer settings are managed from Settings -> General.
