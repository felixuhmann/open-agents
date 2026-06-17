/**
 * pg-boss queue names and the data shapes for each queued job. Workers
 * register against `JOB_*` constants; producers send the matching
 * `*JobData` payload.
 */

export const JOB_RUN_AGENT = "run-agent";
export const JOB_RUN_WORKFLOW = "run-workflow";
export const JOB_SEND_EMAIL = "send-email";
export const JOB_SANDBOX_RECONCILE = "sandbox-reconcile";
export const JOB_SCHEDULED_TASK_DISPATCH = "scheduled-task-dispatch";
export const JOB_RUN_SCHEDULED_TASK = "run-scheduled-task";
export const JOB_SCHEDULED_TASK_MONITOR = "scheduled-task-monitor";

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

/**
 * Agent email: `threadId` + `agentRunId`. Workflow email: `workflowThreadId` +
 * `agentRunId` (final pipeline step run for attachments).
 */
export type SendEmailJobData = {
  threadId?: string;
  workflowThreadId?: string;
  agentRunId: string;
  body: string;
};

export type SandboxReconcileJobData = Record<string, never>;

/**
 * One pipeline run for a single workflow chat turn. The worker resolves the
 * ordered steps from the pinned WorkflowVersion, runs each agent in sequence,
 * and chains each step's text + file outputs into the next step's input.
 */
export type RunWorkflowJobData = {
  workflowRunId: string;
  /** Set when the run originated from inbound email (step-0 file mounts). */
  workflowEmailMessageId?: string;
};

export type ScheduledTaskDispatchJobData = Record<string, never>;
export type RunScheduledTaskJobData = { scheduledTaskRunId: string };
export type ScheduledTaskMonitorJobData = Record<string, never>;
