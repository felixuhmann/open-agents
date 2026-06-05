import type { IssueDetailRunEvent, WorkflowTrace } from "@/lib/queries";

const OMITTED_EVENT_TYPES = new Set([
  "workflow.step.delta",
  "agent.delta",
  "tool.output",
]);

export function buildWorkflowTraceExport(data: WorkflowTrace): unknown {
  const omitted: Record<string, number> = {};
  return {
    surface: data.surface,
    workflow: {
      id: data.workflow.id,
      slug: data.workflow.slug,
      displayName: data.workflow.displayName,
      description: data.workflow.description,
      currentVersionId: data.workflow.currentVersionId,
      currentVersionNumber: data.workflow.currentVersionNumber,
      publishedAt: data.workflow.publishedAt,
    },
    session: {
      ...data.session,
      sandboxes: data.session.sandboxes.map((sandbox) => ({
        id: sandbox.id,
        provider: sandbox.provider,
        providerSandboxId: sandbox.providerSandboxId,
        sessionId: sandbox.sessionId,
        state: sandbox.state,
        workspaceDir: sandbox.workspaceDir,
        lastActivityAt: sandbox.lastActivityAt,
      })),
    },
    messages: data.messages.map((message) => ({
      ...message,
      content: compactString(message.content, 2_000),
    })),
    runs: data.runs.map((run) => ({
      id: run.id,
      workflowVersionId: run.workflowVersionId,
      versionNumber: run.versionNumber,
      status: run.status,
      error: run.error,
      outputChars: run.output?.length ?? 0,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      eventCounts: countEventsByType(run.events),
      events: compactEvents(run.events, omitted),
      stepRuns: run.stepRuns.map((step) => ({
        id: step.id,
        position: step.position,
        agentSlug: step.agentSlug,
        agentDisplayName: step.agentDisplayName,
        runId: step.runId,
        status: step.status,
        error: step.error,
        inputChars: step.inputText?.length ?? 0,
        outputChars: step.output?.length ?? 0,
        agentRun: step.agentRun
          ? {
              id: step.agentRun.id,
              status: step.agentRun.status,
              sessionId: step.agentRun.sessionId,
              eventCounts: countEventsByType(step.agentRun.events),
              events: compactEvents(step.agentRun.events, omitted),
            }
          : null,
      })),
    })),
    omitted,
  };
}

function compactEvents(
  events: IssueDetailRunEvent[],
  omitted: Record<string, number>,
): IssueDetailRunEvent[] {
  const compacted: IssueDetailRunEvent[] = [];
  for (const event of events) {
    if (OMITTED_EVENT_TYPES.has(event.type)) {
      omitted[event.type] = (omitted[event.type] ?? 0) + 1;
      continue;
    }
    compacted.push({
      ...event,
      payload: compactPayload(event),
    });
  }
  return compacted;
}

function compactPayload(event: IssueDetailRunEvent): unknown {
  const payload = event.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return event.payload;
  if (event.type.endsWith(".succeeded") || event.type === "run.succeeded") {
    const output = payload.output;
    return {
      ...payload,
      output:
        typeof output === "string"
          ? { chars: output.length, preview: compactString(output, 1_000) }
          : output,
    };
  }
  return payload;
}

function compactString(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function countEventsByType(events: IssueDetailRunEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}
