import { AgentConfigSnapshot, type SkillMaterializationEntry } from "@open-agents/types";
import { prisma } from "../db.js";
import { parseDaytonaSessionId } from "./daytonaSandbox.js";
import { HttpError } from "../auth/middleware.js";

/**
 * Agent session trace payloads for builder debugging (chat/email) and
 * issue investigation. Issue rows add reporter metadata on top.
 */

export type IssueDetailRunEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: unknown;
};

export type IssueDetailSandbox = {
  id: string;
  provider: string;
  providerSandboxId: string;
  sessionId: string;
  state: string;
  workspaceDir: string | null;
  lifecyclePolicy: unknown;
  lastActivityAt: string;
  lastSyncedAt: string | null;
  errorReason: string | null;
  recoverable: boolean | null;
};

export type IssueDetailRun = {
  id: string;
  surface: "chat" | "email";
  sessionId: string | null;
  runtimeBackend: string | null;
  providerSandboxId: string | null;
  workspaceDir: string | null;
  agentVersionId: string | null;
  versionNumber: number | null;
  versionPayload: unknown;
  status: string;
  error: string | null;
  output: string | null;
  startedAt: string;
  completedAt: string | null;
  skillsAvailable: IssueDetailRunSkill[];
  events: IssueDetailRunEvent[];
};

export type IssueDetailMessage =
  | {
      kind: "chat";
      id: string;
      role: string;
      content: string;
      runId: string | null;
      createdAt: string;
    }
  | {
      kind: "email";
      id: string;
      direction: "inbound" | "outbound";
      subject: string;
      body: string;
      createdAt: string;
    };

export type IssueDetailToolBinding = {
  bindingId: string;
  toolId: string;
  key: string;
  name: string;
  runtime: "managed" | "platform";
  deprecated: boolean;
};

export type IssueDetailSkillBinding = {
  bindingId: string;
  skillId: string;
  skillVersionId: string;
  name: string;
  versionNumber: number;
};

export type IssueDetailRunSkill = SkillMaterializationEntry;

export type IssueDetailThirdPartyMcp = {
  id: string;
  label: string;
  serverUrl: string;
};

export type IssueDetailAgent = {
  id: string;
  slug: string;
  displayName: string;
  avatar: string | null;
  description: string | null;
  modelProvider: string;
  modelId: string;
  systemPrompt: string;
  emailEnabled: boolean;
  webEnabled: boolean;
  inboundLocalPart: string;
  currentVersionNumber: number | null;
  currentVersionId: string | null;
  tools: IssueDetailToolBinding[];
  skills: IssueDetailSkillBinding[];
  mcpServers: IssueDetailThirdPartyMcp[];
  publishedPayload: unknown;
  publishedAt: string | null;
};

export type SessionTrace = {
  surface: "chat" | "email";
  agent: IssueDetailAgent;
  session: {
    conversationId: string | null;
    threadId: string | null;
    label: string;
    userEmail: string | null;
    backendSessionIds: string[];
    sandboxes: IssueDetailSandbox[];
  };
  messages: IssueDetailMessage[];
  runs: IssueDetailRun[];
};

const agentInclude = {
  toolBindings: { include: { tool: true } },
  skillBindings: { include: { skill: true, skillVersion: true } },
  mcpBindings: { include: { mcpServer: true } },
  versions: { orderBy: { createdAt: "desc" as const }, take: 1 },
  currentVersion: true,
} as const;

type AgentWithBindings = {
  id: string;
  slug: string;
  displayName: string;
  avatar: string | null;
  description: string | null;
  modelProvider: string;
  modelId: string;
  systemPrompt: string;
  emailEnabled: boolean;
  webEnabled: boolean;
  inboundLocalPart: string;
  currentVersionId: string | null;
  currentVersion: { versionNumber: number; payload: unknown; createdAt: Date } | null;
  versions: Array<{ payload: unknown; createdAt: Date }>;
  toolBindings: Array<{
    id: string;
    tool: {
      id: string;
      key: string;
      name: string;
      runtime: string;
      deprecated: boolean;
    };
  }>;
  skillBindings: Array<{
    agentId: string;
    skillId: string;
    skillVersionId: string;
    skill: { id: string; name: string };
    skillVersion: {
      versionNumber: number;
    };
  }>;
  mcpBindings: Array<{
    mcpServer: { id: string; name: string; label: string; serverUrl: string };
  }>;
};

type RunWithEvents = {
  id: string;
  surface: string;
  sessionId: string;
  agentVersionId: string | null;
  status: string;
  error: string | null;
  output: string | null;
  startedAt: Date;
  completedAt: Date | null;
  agentVersion: { versionNumber: number; payload: unknown } | null;
  events: Array<{ seq: number; type: string; payload: unknown; createdAt: Date }>;
};

function toIssueDetailAgent(agent: AgentWithBindings): IssueDetailAgent {
  const latestVersion = agent.currentVersion ?? agent.versions[0] ?? null;
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    avatar: agent.avatar,
    description: agent.description,
    modelProvider: agent.modelProvider,
    modelId: agent.modelId,
    systemPrompt: agent.systemPrompt,
    emailEnabled: agent.emailEnabled,
    webEnabled: agent.webEnabled,
    inboundLocalPart: agent.inboundLocalPart,
    currentVersionNumber: agent.currentVersion?.versionNumber ?? null,
    currentVersionId: agent.currentVersionId,
    tools: agent.toolBindings.map((b) => ({
      bindingId: b.id,
      toolId: b.tool.id,
      key: b.tool.key,
      name: b.tool.name,
      runtime: b.tool.runtime === "managed" ? "managed" : "platform",
      deprecated: b.tool.deprecated,
    })),
    skills: agent.skillBindings.map((b) => ({
      bindingId: `${b.agentId}:${b.skillId}`,
      skillId: b.skill.id,
      skillVersionId: b.skillVersionId,
      name: b.skill.name,
      versionNumber: b.skillVersion.versionNumber,
    })),
    mcpServers: agent.mcpBindings.map((b) => ({
      id: b.mcpServer.id,
      label: b.mcpServer.label,
      serverUrl: b.mcpServer.serverUrl,
    })),
    publishedPayload: latestVersion?.payload ?? null,
    publishedAt: latestVersion?.createdAt.toISOString() ?? null,
  };
}

function collectSessionIds(runs: IssueDetailRun[]): string[] {
  const sessionIds: string[] = [];
  for (const r of runs) {
    if (r.sessionId && !sessionIds.includes(r.sessionId)) {
      sessionIds.push(r.sessionId);
    }
  }
  return sessionIds;
}

async function loadSandboxes(args: {
  conversationId: string | null;
  threadId: string | null;
  sessionIds: string[];
  runs: IssueDetailRun[];
}): Promise<IssueDetailSandbox[]> {
  const sandboxOr: Array<
    { conversationId: string } | { threadId: string } | { sessionId: { in: string[] } }
  > = [
    ...(args.conversationId ? [{ conversationId: args.conversationId }] : []),
    ...(args.threadId ? [{ threadId: args.threadId }] : []),
    ...(args.sessionIds.length > 0 ? [{ sessionId: { in: args.sessionIds } }] : []),
  ];
  const sandboxRows =
    sandboxOr.length > 0
      ? await prisma.agentSandbox.findMany({
          where: { OR: sandboxOr },
          orderBy: { lastActivityAt: "desc" },
        })
      : [];
  return sandboxRows.map((row) => ({
    id: row.id,
    provider: row.provider,
    providerSandboxId: row.providerSandboxId,
    sessionId: row.sessionId,
    state: row.state,
    workspaceDir: extractWorkspaceDirFromRuns(args.runs, row.sessionId),
    lifecyclePolicy: row.lifecyclePolicy,
    lastActivityAt: row.lastActivityAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    errorReason: row.errorReason,
    recoverable: row.recoverable,
  }));
}

/**
 * Full trace for a chat conversation: messages, run events, agent config,
 * sessions, and Daytona sandboxes. Used by the builder debug UI and issues.
 */
export async function getConversationTrace(
  conversationId: string,
): Promise<SessionTrace> {
  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      user: { select: { email: true } },
      agent: { include: agentInclude },
      messages: {
        where: { role: { in: ["user", "assistant", "system"] } },
        orderBy: { createdAt: "asc" },
      },
      runs: {
        orderBy: { startedAt: "asc" },
        include: {
          events: { orderBy: { seq: "asc" } },
          agentVersion: true,
        },
      },
    },
  });
  if (!conv) throw new HttpError(404, "conversation not found");

  const messages: IssueDetailMessage[] = conv.messages.map((m) => ({
    kind: "chat",
    id: m.id,
    role: m.role,
    content: m.content,
    runId: m.runId,
    createdAt: m.createdAt.toISOString(),
  }));
  const runs = conv.runs.map(toIssueDetailRun);
  const sessionIds = collectSessionIds(runs);
  const sandboxes = await loadSandboxes({
    conversationId: conv.id,
    threadId: null,
    sessionIds,
    runs,
  });

  return {
    surface: "chat",
    agent: toIssueDetailAgent(conv.agent),
    session: {
      conversationId: conv.id,
      threadId: null,
      label: conv.title,
      userEmail: conv.user?.email ?? null,
      backendSessionIds: sessionIds,
      sandboxes,
    },
    messages,
    runs,
  };
}

/**
 * Full trace for an email thread (issue viewer and future builder tools).
 */
export async function getEmailThreadTrace(threadId: string): Promise<SessionTrace> {
  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    include: {
      agent: { include: agentInclude },
      messages: { orderBy: { createdAt: "asc" } },
      runs: {
        orderBy: { startedAt: "asc" },
        include: {
          events: { orderBy: { seq: "asc" } },
          agentVersion: true,
        },
      },
    },
  });
  if (!thread) throw new HttpError(404, "thread not found");

  const messages: IssueDetailMessage[] = thread.messages.map((m) => ({
    kind: "email",
    id: m.id,
    direction: m.direction === "inbound" ? "inbound" : "outbound",
    subject: m.subject,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));
  const runs = thread.runs.map(toIssueDetailRun);
  const sessionIds = collectSessionIds(runs);
  const sandboxes = await loadSandboxes({
    conversationId: null,
    threadId: thread.id,
    sessionIds,
    runs,
  });

  return {
    surface: "email",
    agent: toIssueDetailAgent(thread.agent),
    session: {
      conversationId: null,
      threadId: thread.id,
      label: thread.subject,
      userEmail: thread.userEmail,
      backendSessionIds: sessionIds,
      sandboxes,
    },
    messages,
    runs,
  };
}

function isSkillsMaterializedPayload(
  payload: unknown,
): payload is { skills: IssueDetailRunSkill[] } {
  if (typeof payload !== "object" || payload === null) return false;
  if (!("skills" in payload)) return false;
  return Array.isArray(payload.skills);
}

function skillsFromRunEvents(events: RunWithEvents["events"]): IssueDetailRunSkill[] {
  const materialized = events.find((e) => e.type === "skills.materialized");
  if (!materialized || !isSkillsMaterializedPayload(materialized.payload)) {
    return [];
  }
  return materialized.payload.skills;
}

function runtimeBackendFromVersion(payload: unknown): string | null {
  if (!payload) return null;
  try {
    return AgentConfigSnapshot.parse(payload).runtime.backend;
  } catch {
    return null;
  }
}

function sandboxMetaFromRunEvents(events: RunWithEvents["events"]): {
  providerSandboxId: string | null;
  workspaceDir: string | null;
} {
  const started = events.find((e) => e.type === "run.started");
  if (started?.payload && typeof started.payload === "object") {
    const p = started.payload as Record<string, unknown>;
    const providerSandboxId =
      typeof p.providerSandboxId === "string" ? p.providerSandboxId : null;
    const workspaceDir = typeof p.workspaceDir === "string" ? p.workspaceDir : null;
    if (providerSandboxId || workspaceDir) {
      return { providerSandboxId, workspaceDir };
    }
  }
  const created = events.find((e) => e.type === "sandbox.created");
  if (created?.payload && typeof created.payload === "object") {
    const p = created.payload as Record<string, unknown>;
    return {
      providerSandboxId:
        typeof p.providerSandboxId === "string" ? p.providerSandboxId : null,
      workspaceDir: typeof p.workspaceDir === "string" ? p.workspaceDir : null,
    };
  }
  return { providerSandboxId: null, workspaceDir: null };
}

function extractWorkspaceDirFromRuns(
  runs: IssueDetailRun[],
  sessionId: string,
): string | null {
  const run = runs.find((r) => r.sessionId === sessionId);
  return run?.workspaceDir ?? null;
}

function providerSandboxIdFromSessionId(sessionId: string | null): string | null {
  if (!sessionId?.startsWith("daytona:")) return null;
  try {
    return parseDaytonaSessionId(sessionId).sandboxId;
  } catch {
    return null;
  }
}

function toIssueDetailRun(r: RunWithEvents): IssueDetailRun {
  const events = r.events.map((e) => ({
    seq: e.seq,
    type: e.type,
    createdAt: e.createdAt.toISOString(),
    payload: e.payload,
  }));
  const sessionId = r.sessionId === "" ? null : r.sessionId;
  const sandboxMeta = sandboxMetaFromRunEvents(r.events);
  const providerSandboxId =
    sandboxMeta.providerSandboxId ?? providerSandboxIdFromSessionId(sessionId);
  return {
    id: r.id,
    surface: r.surface as "chat" | "email",
    sessionId,
    runtimeBackend: runtimeBackendFromVersion(r.agentVersion?.payload),
    providerSandboxId,
    workspaceDir: sandboxMeta.workspaceDir,
    agentVersionId: r.agentVersionId,
    versionNumber: r.agentVersion?.versionNumber ?? null,
    versionPayload: r.agentVersion?.payload ?? null,
    status: r.status,
    error: r.error,
    output: r.output,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    skillsAvailable: skillsFromRunEvents(r.events),
    events,
  };
}
