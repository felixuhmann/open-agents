import type {
  IssueDetailAgent,
  IssueDetailMessage,
  IssueDetailRun,
  IssueDetailRunEvent,
  IssueDetailSandbox,
  SessionTrace,
} from "@/lib/queries";

const OMITTED_EVENT_TYPES = new Set(["agent.delta", "tool.output"]);
const MAX_COPIED_STRING_CHARS = 12_000;
const RUN_OUTPUT_PREVIEW_CHARS = 1_500;

type OmissionAccumulator = {
  eventTypes: Record<string, number>;
  truncatedStrings: number;
};

type CompactTimelineItem =
  | {
      kind: "message";
      ts: string;
      message: IssueDetailMessage;
    }
  | {
      kind: "event";
      ts: string;
      runId: string;
      runStatus: string;
      runStartedAt: string;
      runVersionNumber: number | null;
      sessionId: string | null;
      event: IssueDetailRunEvent;
    };

export function buildSessionTraceExport(data: SessionTrace): unknown {
  const omissions = createOmissionAccumulator();
  return {
    surface: data.surface,
    agent: compactAgent(data.agent, omissions),
    session: compactSession(data.session, omissions),
    runs: data.runs.map((run) => compactRun(run)),
    timeline: buildCompactTimeline(data, omissions),
    omitted: buildOmissionSummary(omissions, [
      "agent.publishedPayload",
      "runs[].versionPayload",
      "duplicated raw runs/messages arrays",
    ]),
  };
}

export function buildCompactRunEventsExport(runs: IssueDetailRun[]): unknown {
  const omissions = createOmissionAccumulator();
  return {
    runs: runs.map((run) => ({
      ...compactRun(run),
      events: run.events
        .filter((event) => shouldKeepEvent(event, omissions))
        .map((event) => compactEvent(event, omissions)),
    })),
    omitted: buildOmissionSummary(omissions, ["runs[].versionPayload"]),
  };
}

function createOmissionAccumulator(): OmissionAccumulator {
  return { eventTypes: {}, truncatedStrings: 0 };
}

function compactAgent(agent: IssueDetailAgent, omissions: OmissionAccumulator) {
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    modelProvider: agent.modelProvider,
    modelId: agent.modelId,
    systemPrompt: compactString(agent.systemPrompt, omissions),
    emailEnabled: agent.emailEnabled,
    webEnabled: agent.webEnabled,
    inboundLocalPart: agent.inboundLocalPart,
    currentVersionNumber: agent.currentVersionNumber,
    currentVersionId: agent.currentVersionId,
    publishedAt: agent.publishedAt,
    tools: agent.tools.map(({ bindingId, key, name, runtime, deprecated }) => ({
      bindingId,
      key,
      name,
      runtime,
      deprecated,
    })),
    skills: agent.skills,
    mcpServers: agent.mcpServers,
  };
}

function compactSession(
  session: SessionTrace["session"],
  omissions: OmissionAccumulator,
) {
  return {
    ...session,
    sandboxes: session.sandboxes.map((sandbox) => compactSandbox(sandbox, omissions)),
  };
}

function compactSandbox(sandbox: IssueDetailSandbox, omissions: OmissionAccumulator) {
  return compactUnknown(sandbox, omissions) as IssueDetailSandbox;
}

function compactRun(run: IssueDetailRun) {
  return {
    id: run.id,
    surface: run.surface,
    sessionId: run.sessionId,
    runtimeBackend: run.runtimeBackend,
    providerSandboxId: run.providerSandboxId,
    workspaceDir: run.workspaceDir,
    agentVersionId: run.agentVersionId,
    versionNumber: run.versionNumber,
    status: run.status,
    error: run.error,
    outputChars: run.output?.length ?? 0,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    skillsAvailable: run.skillsAvailable,
    eventCounts: countEventsByType(run.events),
  };
}

function buildCompactTimeline(
  data: SessionTrace,
  omissions: OmissionAccumulator,
): CompactTimelineItem[] {
  const out: CompactTimelineItem[] = [];
  for (const message of data.messages) {
    out.push({
      kind: "message",
      ts: message.createdAt,
      message: compactUnknown(message, omissions) as IssueDetailMessage,
    });
  }
  for (const run of data.runs) {
    for (const event of run.events) {
      if (!shouldKeepEvent(event, omissions)) continue;
      out.push({
        kind: "event",
        ts: event.createdAt,
        runId: run.id,
        runStatus: run.status,
        runStartedAt: run.startedAt,
        runVersionNumber: run.versionNumber,
        sessionId: run.sessionId,
        event: compactEvent(event, omissions),
      });
    }
  }
  out.sort((a, b) => {
    const at = new Date(a.ts).getTime();
    const bt = new Date(b.ts).getTime();
    if (at !== bt) return at - bt;
    if (a.kind === "event" && b.kind === "event") {
      if (a.runId !== b.runId) return a.runId.localeCompare(b.runId);
      return a.event.seq - b.event.seq;
    }
    return 0;
  });
  return out;
}

function shouldKeepEvent(
  event: IssueDetailRunEvent,
  omissions: OmissionAccumulator,
): boolean {
  if (!OMITTED_EVENT_TYPES.has(event.type)) return true;
  omissions.eventTypes[event.type] = (omissions.eventTypes[event.type] ?? 0) + 1;
  return false;
}

function compactEvent(
  event: IssueDetailRunEvent,
  omissions: OmissionAccumulator,
): IssueDetailRunEvent {
  return {
    ...event,
    payload: compactEventPayload(event, omissions),
  };
}

function compactEventPayload(
  event: IssueDetailRunEvent,
  omissions: OmissionAccumulator,
): unknown {
  if (event.type !== "run.succeeded") {
    return compactUnknown(event.payload, omissions);
  }

  const payload = event.payload as Record<string, unknown> | null;
  const output = payload?.output;
  return {
    type: "run.succeeded",
    outputChars: typeof output === "string" ? output.length : 0,
    outputPreview:
      typeof output === "string"
        ? compactString(output, omissions, RUN_OUTPUT_PREVIEW_CHARS)
        : null,
  };
}

function countEventsByType(events: IssueDetailRunEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

function compactUnknown(
  value: unknown,
  omissions: OmissionAccumulator,
  depth = 0,
): unknown {
  if (depth > 12) return "[max depth]";
  if (typeof value === "string") return compactString(value, omissions);
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => compactUnknown(item, omissions, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = compactUnknown(item, omissions, depth + 1);
    }
    return out;
  }
  return "[unserializable]";
}

function compactString(
  value: string,
  omissions: OmissionAccumulator,
  maxChars = MAX_COPIED_STRING_CHARS,
): string {
  if (value.length <= maxChars) return value;
  omissions.truncatedStrings += 1;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function buildOmissionSummary(omissions: OmissionAccumulator, omittedFields: string[]) {
  return {
    eventTypes: omissions.eventTypes,
    fields: omittedFields,
    truncatedStrings: omissions.truncatedStrings,
    notes: [
      "agent.delta events are incremental assistant text chunks; final assistant messages and run outputs remain.",
      "tool.output events are streaming stdout/stderr chunks; tool.use and tool.result events remain.",
      "Large string fields are capped in copied traces with an inline truncation marker.",
    ],
  };
}
