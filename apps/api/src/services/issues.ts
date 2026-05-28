import { AgentConfigSnapshot, type SkillMaterializationEntry } from "@open-agents/types";
import { prisma } from "../db.js";
import { parseDaytonaSessionId } from "./daytonaSandbox.js";
import { HttpError } from "../auth/middleware.js";
import { log } from "../log.js";

/**
 * User-filed issues against agent sessions. Domain logic shared between
 * the cookie-authed `/api/issues` admin routes and the public
 * `/issues/report` flow used by email recipients (no SPA session).
 */

export type IssueListRow = {
  id: string;
  surface: "chat" | "email";
  status: "open" | "resolved";
  description: string;
  reporterEmail: string;
  reporterUserId: string | null;
  reporterName: string | null;
  agent: {
    id: string;
    slug: string;
    displayName: string;
    avatar: string | null;
  };
  conversationId: string | null;
  threadId: string | null;
  /// Subject (email) or conversation title (chat) for the listing.
  sessionLabel: string;
  createdAt: string;
  resolvedAt: string | null;
};

const DESCRIPTION_MIN = 1;
const DESCRIPTION_MAX = 4000;

function normaliseDescription(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, "description must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length < DESCRIPTION_MIN) {
    throw new HttpError(400, "description is required");
  }
  if (trimmed.length > DESCRIPTION_MAX) {
    throw new HttpError(400, `description must be ≤ ${DESCRIPTION_MAX} characters`);
  }
  return trimmed;
}

/**
 * File an issue against a chat conversation. Caller must own the
 * conversation (`requireUser` in the route already established the principal).
 */
export async function createChatIssue(args: {
  conversationId: string;
  reporterUserId: string;
  reporterEmail: string;
  description: string;
}): Promise<{ id: string }> {
  const description = normaliseDescription(args.description);
  const conv = await prisma.chatConversation.findUnique({
    where: { id: args.conversationId },
    select: { id: true, agentId: true, userId: true },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  const issue = await prisma.issue.create({
    data: {
      agentId: conv.agentId,
      surface: "chat",
      conversationId: conv.id,
      reporterUserId: args.reporterUserId,
      reporterEmail: args.reporterEmail,
      description,
      status: "open",
    },
  });
  log.info("issues: chat issue filed", {
    issueId: issue.id,
    conversationId: conv.id,
    agentId: conv.agentId,
    reporterUserId: args.reporterUserId,
  });
  return { id: issue.id };
}

/**
 * File an issue against an email thread. Used by the public
 * `/issues/report` route after token verification — there's no cookie
 * session, so the route hands us the verified threadId+email directly.
 */
export async function createEmailIssue(args: {
  threadId: string;
  reporterEmail: string;
  description: string;
}): Promise<{ id: string }> {
  const description = normaliseDescription(args.description);
  const thread = await prisma.emailThread.findUnique({
    where: { id: args.threadId },
    select: { id: true, agentId: true, userEmail: true },
  });
  if (!thread) throw new HttpError(404, "thread not found");
  // The signed token already binds the email to the thread — but match it
  // case-insensitively against the thread row as a defense-in-depth check.
  if (thread.userEmail.trim().toLowerCase() !== args.reporterEmail.trim().toLowerCase()) {
    throw new HttpError(403, "email does not match thread");
  }
  // Best-effort link to a User row if one exists (admin sees a real
  // reporter rather than just a string).
  const user = await prisma.user.findUnique({
    where: { email: thread.userEmail },
    select: { id: true },
  });
  const issue = await prisma.issue.create({
    data: {
      agentId: thread.agentId,
      surface: "email",
      threadId: thread.id,
      reporterUserId: user?.id ?? null,
      reporterEmail: thread.userEmail,
      description,
      status: "open",
    },
  });
  log.info("issues: email issue filed", {
    issueId: issue.id,
    threadId: thread.id,
    agentId: thread.agentId,
    reporterEmail: thread.userEmail,
  });
  return { id: issue.id };
}

export async function listIssues(args: {
  status?: "open" | "resolved";
}): Promise<IssueListRow[]> {
  const rows = await prisma.issue.findMany({
    where: { ...(args.status ? { status: args.status } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
      reporter: { select: { id: true, name: true } },
      conversation: { select: { title: true } },
      thread: { select: { subject: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    surface: r.surface as "chat" | "email",
    status: r.status as "open" | "resolved",
    description: r.description,
    reporterEmail: r.reporterEmail,
    reporterUserId: r.reporterUserId,
    reporterName: r.reporter?.name ?? null,
    agent: {
      id: r.agent.id,
      slug: r.agent.slug,
      displayName: r.agent.displayName,
      avatar: r.agent.avatar,
    },
    conversationId: r.conversationId,
    threadId: r.threadId,
    sessionLabel:
      r.surface === "chat"
        ? (r.conversation?.title ?? "Conversation")
        : (r.thread?.subject ?? "Email thread"),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

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
  /// Backend session id this run executed against.
  sessionId: string | null;
  /// Runtime backend from pinned version snapshot (`daytona` | `anthropic`).
  runtimeBackend: string | null;
  providerSandboxId: string | null;
  workspaceDir: string | null;
  /// Frozen config version pinned at enqueue time.
  agentVersionId: string | null;
  versionNumber: number | null;
  versionPayload: unknown;
  status: string;
  error: string | null;
  output: string | null;
  startedAt: string;
  completedAt: string | null;
  /// Skill versions unpacked into the sandbox when this run created a new
  /// Daytona session (`skills.materialized` event). Empty when the run
  /// resumed an existing session or the backend is Anthropic.
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
  anthropicSkillId: string | null;
  anthropicSkillVersion: string | null;
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
  model: string;
  systemPrompt: string;
  emailEnabled: boolean;
  webEnabled: boolean;
  inboundLocalPart: string;
  /// Latest published version number (draft edits are not reflected here).
  currentVersionNumber: number | null;
  currentVersionId: string | null;
  tools: IssueDetailToolBinding[];
  skills: IssueDetailSkillBinding[];
  thirdPartyMcp: IssueDetailThirdPartyMcp[];
  /// Snapshot of the most recent published runtime config.
  publishedPayload: unknown;
  publishedAt: string | null;
};

export type IssueDetail = {
  id: string;
  surface: "chat" | "email";
  status: "open" | "resolved";
  description: string;
  reporterEmail: string;
  reporterUserId: string | null;
  reporterName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolvedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  agent: IssueDetailAgent;
  session: {
    conversationId: string | null;
    threadId: string | null;
    label: string;
    userEmail: string | null;
    /// Distinct backend session ids observed across runs on this session.
    backendSessionIds: string[];
    /// Daytona sandboxes linked to this conversation/thread or session ids.
    sandboxes: IssueDetailSandbox[];
  };
  messages: IssueDetailMessage[];
  runs: IssueDetailRun[];
};

/**
 * Full detail for the admin issue viewer: reporter info, the raw
 * conversation/thread messages, every `AgentRun`'s `RunEvent` log, and
 * the agent context (identity, model, tools, skills, third-party MCPs,
 * system prompt, and published version snapshots) so the admin can inspect
 * tool calls, thinking, and errors against the configuration that
 * produced them.
 */
export async function getIssueDetail(id: string): Promise<IssueDetail> {
  const issue = await prisma.issue.findUnique({
    where: { id },
    include: {
      agent: {
        include: {
          toolBindings: { include: { tool: true } },
          skillBindings: { include: { skill: true, skillVersion: true } },
          thirdPartyMcp: true,
          versions: { orderBy: { createdAt: "desc" }, take: 1 },
          currentVersion: true,
        },
      },
      reporter: { select: { id: true, name: true } },
      resolvedBy: { select: { name: true, email: true } },
    },
  });
  if (!issue) throw new HttpError(404, "issue not found");

  let messages: IssueDetailMessage[] = [];
  let runs: IssueDetailRun[] = [];
  let sessionLabel = "";
  let userEmail: string | null = null;

  if (issue.surface === "chat" && issue.conversationId) {
    const conv = await prisma.chatConversation.findUnique({
      where: { id: issue.conversationId },
      include: {
        user: { select: { email: true } },
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
    if (conv) {
      sessionLabel = conv.title;
      userEmail = conv.user?.email ?? null;
      messages = conv.messages.map((m) => ({
        kind: "chat",
        id: m.id,
        role: m.role,
        content: m.content,
        runId: m.runId,
        createdAt: m.createdAt.toISOString(),
      }));
      runs = conv.runs.map(toIssueDetailRun);
    }
  } else if (issue.surface === "email" && issue.threadId) {
    const thread = await prisma.emailThread.findUnique({
      where: { id: issue.threadId },
      include: {
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
    if (thread) {
      sessionLabel = thread.subject;
      userEmail = thread.userEmail;
      messages = thread.messages.map((m) => ({
        kind: "email",
        id: m.id,
        direction: m.direction === "inbound" ? "inbound" : "outbound",
        subject: m.subject,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));
      runs = thread.runs.map(toIssueDetailRun);
    }
  }

  const latestVersion = issue.agent.currentVersion ?? issue.agent.versions[0] ?? null;

  // Distinct session ids in encounter order. Most sessions have one,
  // but attachments force a new session so we may have 2+ — surfacing
  // every id helps when correlating with Anthropic's dashboard.
  const sessionIds: string[] = [];
  for (const r of runs) {
    if (r.sessionId && !sessionIds.includes(r.sessionId)) {
      sessionIds.push(r.sessionId);
    }
  }

  const sandboxOr: Array<
    { conversationId: string } | { threadId: string } | { sessionId: { in: string[] } }
  > = [
    ...(issue.conversationId ? [{ conversationId: issue.conversationId }] : []),
    ...(issue.threadId ? [{ threadId: issue.threadId }] : []),
    ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
  ];
  const sandboxRows =
    sandboxOr.length > 0
      ? await prisma.agentSandbox.findMany({
          where: { OR: sandboxOr },
          orderBy: { lastActivityAt: "desc" },
        })
      : [];
  const sandboxes: IssueDetailSandbox[] = sandboxRows.map((row) => ({
    id: row.id,
    provider: row.provider,
    providerSandboxId: row.providerSandboxId,
    sessionId: row.sessionId,
    state: row.state,
    workspaceDir: extractWorkspaceDirFromRuns(runs, row.sessionId),
    lifecyclePolicy: row.lifecyclePolicy,
    lastActivityAt: row.lastActivityAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    errorReason: row.errorReason,
    recoverable: row.recoverable,
  }));

  const agent: IssueDetailAgent = {
    id: issue.agent.id,
    slug: issue.agent.slug,
    displayName: issue.agent.displayName,
    avatar: issue.agent.avatar,
    description: issue.agent.description,
    model: issue.agent.model,
    systemPrompt: issue.agent.systemPrompt,
    emailEnabled: issue.agent.emailEnabled,
    webEnabled: issue.agent.webEnabled,
    inboundLocalPart: issue.agent.inboundLocalPart,
    currentVersionNumber: issue.agent.currentVersion?.versionNumber ?? null,
    currentVersionId: issue.agent.currentVersionId,
    tools: issue.agent.toolBindings.map((b) => ({
      bindingId: b.id,
      toolId: b.tool.id,
      key: b.tool.key,
      name: b.tool.name,
      runtime: b.tool.runtime === "managed" ? "managed" : "platform",
      deprecated: b.tool.deprecated,
    })),
    skills: issue.agent.skillBindings.map((b) => ({
      bindingId: `${b.agentId}:${b.skillId}`,
      skillId: b.skill.id,
      skillVersionId: b.skillVersionId,
      name: b.skill.name,
      versionNumber: b.skillVersion.versionNumber,
      anthropicSkillId: b.skillVersion.anthropicSkillId,
      anthropicSkillVersion: b.skillVersion.anthropicSkillVersion,
    })),
    thirdPartyMcp: issue.agent.thirdPartyMcp.map((m) => ({
      id: m.id,
      label: m.label,
      serverUrl: m.serverUrl,
    })),
    publishedPayload: latestVersion?.payload ?? null,
    publishedAt: latestVersion?.createdAt.toISOString() ?? null,
  };

  return {
    id: issue.id,
    surface: issue.surface as "chat" | "email",
    status: issue.status as "open" | "resolved",
    description: issue.description,
    reporterEmail: issue.reporterEmail,
    reporterUserId: issue.reporterUserId,
    reporterName: issue.reporter?.name ?? null,
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    resolvedByName: issue.resolvedBy?.name ?? null,
    resolvedByEmail: issue.resolvedBy?.email ?? null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    agent,
    session: {
      conversationId: issue.conversationId,
      threadId: issue.threadId,
      label: sessionLabel,
      userEmail,
      backendSessionIds: sessionIds,
      sandboxes,
    },
    messages,
    runs,
  };
}

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

export async function setIssueStatus(args: {
  id: string;
  status: "open" | "resolved";
  resolverUserId: string;
}): Promise<void> {
  await prisma.issue.update({
    where: { id: args.id },
    data: {
      status: args.status,
      resolvedAt: args.status === "resolved" ? new Date() : null,
      resolvedById: args.status === "resolved" ? args.resolverUserId : null,
    },
  });
  log.info("issues: status updated", {
    issueId: args.id,
    status: args.status,
    by: args.resolverUserId,
  });
}
