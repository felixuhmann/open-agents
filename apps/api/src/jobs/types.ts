/**
 * pg-boss queue names and the data shapes for each queued job. Workers
 * register against `JOB_*` constants; producers send the matching
 * `*JobData` payload.
 */

export const JOB_RUN_AGENT = "run-agent";
export const JOB_SEND_EMAIL = "send-email";
export const JOB_SANDBOX_RECONCILE = "sandbox-reconcile";

/**
 * `surface` decides what the worker does at the end of a successful run:
 *   - `email` enqueues a `send-email` follow-up
 *   - `chat` is a no-op; the SSE handler already streamed the events
 *
 * Email runs originate from the Mailgun webhook and reference an
 * `EmailMessage`; chat runs originate from the SPA and reference a
 * `ChatMessage`. The worker resolves `agentId` and `sessionId` from the
 * `AgentRun` row in both cases.
 */
export type RunAgentJobData = {
  runId: string;
  surface: "email" | "chat";
  /** Set when surface = `email`. */
  emailMessageId?: string;
  /** Set when surface = `chat`. */
  chatMessageId?: string;
};

export type SendEmailJobData = {
  threadId: string;
  runId: string;
  body: string;
};

export type SandboxReconcileJobData = Record<string, never>;
