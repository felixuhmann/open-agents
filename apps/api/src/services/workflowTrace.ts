import type {
  IssueDetailRun,
  IssueDetailRunEvent,
  IssueDetailSandbox,
} from "./sessionTrace.js";
import { collectSessionIds, loadSandboxes, toIssueDetailRun } from "./sessionTrace.js";
import { HttpError } from "../auth/middleware.js";
import { prisma } from "../db.js";

export type WorkflowTraceMessage = {
  id: string;
  role: string;
  content: string;
  workflowRunId: string | null;
  createdAt: string;
};

export type WorkflowTraceStepRun = {
  id: string;
  position: number;
  agentId: string;
  agentSlug: string;
  agentDisplayName: string;
  agentVersionId: string | null;
  runId: string | null;
  status: string;
  inputText: string | null;
  output: string | null;
  error: string | null;
  createdAt: string;
  agentRun: IssueDetailRun | null;
};

export type WorkflowTraceRun = {
  id: string;
  workflowVersionId: string | null;
  versionNumber: number | null;
  versionPayload: unknown;
  status: string;
  error: string | null;
  output: string | null;
  startedAt: string;
  completedAt: string | null;
  events: IssueDetailRunEvent[];
  stepRuns: WorkflowTraceStepRun[];
};

export type WorkflowTrace = {
  surface: "workflow";
  workflow: {
    id: string;
    slug: string;
    displayName: string;
    description: string | null;
    webEnabled: boolean;
    currentVersionId: string | null;
    currentVersionNumber: number | null;
    publishedPayload: unknown;
    publishedAt: string | null;
  };
  session: {
    conversationId: string;
    label: string;
    userEmail: string | null;
    backendSessionIds: string[];
    sandboxes: IssueDetailSandbox[];
  };
  messages: WorkflowTraceMessage[];
  runs: WorkflowTraceRun[];
};

export async function getWorkflowConversationTrace(
  conversationId: string,
): Promise<WorkflowTrace> {
  const conv = await prisma.workflowConversation.findUnique({
    where: { id: conversationId },
    include: {
      user: { select: { email: true } },
      workflow: {
        include: {
          currentVersion: true,
          versions: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      messages: { orderBy: { createdAt: "asc" } },
      runs: {
        orderBy: { startedAt: "asc" },
        include: {
          events: { orderBy: { seq: "asc" } },
          workflowVersion: true,
          stepRuns: {
            orderBy: { position: "asc" },
            include: {
              run: {
                include: {
                  agent: { select: { displayName: true } },
                  agentVersion: true,
                  events: { orderBy: { seq: "asc" } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!conv) throw new HttpError(404, "workflow conversation not found");

  const runs: WorkflowTraceRun[] = conv.runs.map((run) => ({
    id: run.id,
    workflowVersionId: run.workflowVersionId,
    versionNumber: run.workflowVersion?.versionNumber ?? null,
    versionPayload: run.workflowVersion?.payload ?? null,
    status: run.status,
    error: run.error,
    output: run.output,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    events: run.events.map((event) => ({
      seq: event.seq,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    })),
    stepRuns: run.stepRuns.map((step) => ({
      id: step.id,
      position: step.position,
      agentId: step.agentId,
      agentSlug: step.agentSlug,
      agentDisplayName: step.run?.agent.displayName ?? step.agentSlug,
      agentVersionId: step.agentVersionId,
      runId: step.runId,
      status: step.status,
      inputText: step.inputText,
      output: step.output,
      error: step.error,
      createdAt: step.createdAt.toISOString(),
      agentRun: step.run ? toIssueDetailRun(step.run) : null,
    })),
  }));

  const agentRuns = runs.flatMap((run) =>
    run.stepRuns.flatMap((step) => (step.agentRun ? [step.agentRun] : [])),
  );
  const sessionIds = collectSessionIds(agentRuns);
  const sandboxes = await loadSandboxes({
    conversationId: null,
    threadId: null,
    sessionIds,
    runs: agentRuns,
  });
  const latestVersion = conv.workflow.currentVersion ?? conv.workflow.versions[0] ?? null;

  return {
    surface: "workflow",
    workflow: {
      id: conv.workflow.id,
      slug: conv.workflow.slug,
      displayName: conv.workflow.displayName,
      description: conv.workflow.description,
      webEnabled: conv.workflow.webEnabled,
      currentVersionId: conv.workflow.currentVersionId,
      currentVersionNumber: conv.workflow.currentVersion?.versionNumber ?? null,
      publishedPayload: latestVersion?.payload ?? null,
      publishedAt: latestVersion?.createdAt.toISOString() ?? null,
    },
    session: {
      conversationId: conv.id,
      label: conv.title,
      userEmail: conv.user?.email ?? null,
      backendSessionIds: sessionIds,
      sandboxes,
    },
    messages: conv.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      workflowRunId: message.workflowRunId,
      createdAt: message.createdAt.toISOString(),
    })),
    runs,
  };
}
