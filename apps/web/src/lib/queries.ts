import { useQuery } from "@tanstack/react-query";
import type {
  AgentSummaryDto,
  AnalyticsSummary,
  McpConnectionInfo,
  ModelCatalogDto,
  WorkflowDto,
  WorkflowSummaryDto,
} from "@open-agents/types";
import { api } from "./api";

export type SetupStatus = { complete: boolean; userCount: number };
export type UserRole = "admin" | "contributor" | "member";

export function canOperateAgents(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "contributor";
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ["setup", "status"],
    queryFn: () => api<SetupStatus>("/api/setup/status"),
    staleTime: 0,
    refetchInterval: false,
  });
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth", "session"],
    queryFn: async (): Promise<CurrentUser | null> => {
      const r = await fetch("/api/auth/get-session", {
        credentials: "include",
      });
      if (!r.ok) return null;
      const body = (await r.json()) as { user?: CurrentUser } | null;
      return body?.user ?? null;
    },
    staleTime: 30_000,
  });
}

export type AuthSessionInfo = {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export function useAuthSessions() {
  return useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async (): Promise<AuthSessionInfo[]> => {
      const r = await fetch("/api/auth/list-sessions", {
        credentials: "include",
      });
      if (!r.ok) {
        throw new Error("Failed to load sessions");
      }
      const body = (await r.json()) as Array<{
        id: string;
        createdAt: string;
        updatedAt: string;
        expiresAt: string;
        ipAddress?: string | null;
        userAgent?: string | null;
      }>;
      return body.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
      }));
    },
  });
}

export type CurrentSessionInfo = {
  session: {
    id: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
  };
};

export function useCurrentSession() {
  return useQuery({
    queryKey: ["auth", "session-detail"],
    queryFn: async (): Promise<CurrentSessionInfo | null> => {
      const r = await fetch("/api/auth/get-session", {
        credentials: "include",
      });
      if (!r.ok) return null;
      const body = (await r.json()) as CurrentSessionInfo | null;
      return body;
    },
    staleTime: 30_000,
  });
}

export type ProfileSummary = {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
    createdAt: string | null;
    updatedAt: string | null;
  };
  stats: {
    authSessionCount: number;
    conversationCount: number;
    runCount: number;
    accessibleAgentCount: number;
  };
  activity: {
    lastConversationAt: string | null;
    lastRunAt: string | null;
  };
};

export function useProfileSummary() {
  return useQuery({
    queryKey: ["profile", "summary"],
    queryFn: () => api<ProfileSummary>("/api/profile"),
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      api<{ agents: AgentSummaryDto[] }>("/api/agents").then((r) => r.agents),
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: () =>
      api<{ workflows: WorkflowSummaryDto[] }>("/api/workflows").then((r) => r.workflows),
  });
}

export function useWorkflow(slug: string | undefined) {
  return useQuery({
    enabled: Boolean(slug),
    queryKey: ["workflows", slug],
    queryFn: () => api<WorkflowDto>(`/api/workflows/${slug}`),
  });
}

export function useWorkflowAccess(slug: string | undefined, enabled = true) {
  return useQuery({
    enabled: Boolean(slug) && enabled,
    queryKey: ["workflows", slug, "access"],
    queryFn: () => api<AgentAccessDto>(`/api/workflows/${slug}/access`),
  });
}

export type WorkflowConversationListItem = {
  id: string;
  title: string;
  workflow: { id: string; slug: string; displayName: string };
  updatedAt: string;
};

export function useWorkflowConversations(workflowSlug?: string) {
  return useQuery({
    queryKey: ["workflow-conversations", { workflowSlug: workflowSlug ?? null }],
    queryFn: () => {
      const url = workflowSlug
        ? `/api/workflow-conversations?workflowSlug=${encodeURIComponent(workflowSlug)}`
        : "/api/workflow-conversations";
      return api<{ conversations: WorkflowConversationListItem[] }>(url).then(
        (r) => r.conversations,
      );
    },
  });
}

export type WorkflowChatAttachmentSummary = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type WorkflowChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  workflowRunId: string | null;
  /** Final pipeline step's AgentRun — used for attachment downloads. */
  agentRunId: string | null;
  createdAt: string;
  attachments?: WorkflowChatAttachmentSummary[];
};

export type WorkflowConversationDetail = {
  id: string;
  title: string;
  workflow: { id: string; slug: string; displayName: string };
  activeWorkflowRunId: string | null;
  messages: WorkflowChatMessage[];
};

export function useWorkflowConversation(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ["workflow-conversations", id],
    queryFn: () => api<WorkflowConversationDetail>(`/api/workflow-conversations/${id}`),
  });
}

export type {
  AnalyticsAgentRow,
  AnalyticsMetricRow,
  AnalyticsSummary,
} from "@open-agents/types";

export type AnalyticsRange =
  | { preset: "30d" }
  | { preset: "12m" }
  | { preset: "custom"; from: string; to: string };

function analyticsQueryPath(range: AnalyticsRange): string {
  if (range.preset === "custom") {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    return `/api/analytics?${params.toString()}`;
  }
  return `/api/analytics?window=${range.preset}`;
}

export function useAnalyticsRange(range: AnalyticsRange) {
  return useQuery({
    queryKey: ["analytics", range],
    queryFn: () => api<AnalyticsSummary>(analyticsQueryPath(range)),
  });
}

/**
 * Convert a stored avatar reference (bare filename, `/static/...` URL
 * path, or absolute URL) into something a browser `<img src>` can load.
 * Mirrors `resolveAssetUrl` on the server side; kept inline because the
 * SPA never needs the production `PUBLIC_BASE_URL` prefix (the file is
 * always served from the same origin).
 */
export function avatarSrc(avatar: string | null | undefined): string | undefined {
  if (!avatar) return undefined;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  if (avatar.startsWith("/static/")) return avatar;
  return `/static/${avatar}`;
}

export type ToolRuntime = "managed" | "platform";

export type FullAgentDto = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  category: string | null;
  starterPrompts: string[];
  systemPrompt: string;
  modelProvider: string;
  modelId: string;
  avatar: string | null;
  emailEnabled: boolean;
  webEnabled: boolean;
  accessMode: "everyone" | "specific";
  inboundLocalPart: string;
  mailgunDomain: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  publishedAt: string | null;
  toolBindings: Array<{
    id: string;
    toolId: string;
    tool: { id: string; key: string; name: string; runtime: ToolRuntime };
    configJson: Record<string, unknown>;
  }>;
  skillIds: string[];
  skillBindings: Array<{ skillId: string; skillVersionId: string }>;
  skills: Array<{ id: string; name: string; versionId: string; versionNumber: number }>;
  mcpServers: Array<{ id: string; name: string; label: string; serverUrl: string }>;
  mcpServerIds: string[];
  accessUserIds: string[];
  sandboxNetworkPolicy: {
    internetEnabled: boolean;
    allowList: string;
    protectInternalNetwork: boolean;
  };
  sandboxCommandPolicy: {
    denyRules: string[];
    approvalGatePatterns: string[];
    maxRuntimeSeconds: number;
    maxOutputChars: number;
    maxBackgroundProcessLifetimeSeconds: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type AgentAccessUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  granted: boolean;
};

export type AgentAccessDto = {
  accessMode: "everyone" | "specific";
  users: AgentAccessUser[];
};

export function useAgentAccess(slug: string | undefined, enabled = true) {
  return useQuery({
    enabled: Boolean(slug) && enabled,
    queryKey: ["agents", slug, "access"],
    queryFn: () => api<AgentAccessDto>(`/api/agents/${slug}/access`),
  });
}

export function useAgent(slug: string | undefined) {
  return useQuery({
    enabled: Boolean(slug),
    queryKey: ["agents", slug],
    queryFn: () => api<FullAgentDto>(`/api/agents/${slug}`),
  });
}

export type Tool = {
  id: string;
  key: string;
  name: string;
  description: string;
  runtime: ToolRuntime;
  configSchema: Record<string, unknown>;
  requiresSecrets: boolean;
  deprecated: boolean;
};

export function useTools() {
  return useQuery({
    queryKey: ["tools"],
    queryFn: () => api<{ tools: Tool[] }>("/api/tools").then((r) => r.tools),
  });
}

export function useModelCatalog() {
  return useQuery({
    queryKey: ["models", "catalog"],
    queryFn: () => api<ModelCatalogDto>("/api/models/catalog"),
    staleTime: 60_000,
  });
}

export type SkillDto = {
  id: string;
  name: string;
  description: string | null;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  versions: Array<{
    id: string;
    versionNumber: number;
    filename: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api<{ skills: SkillDto[] }>("/api/skills").then((r) => r.skills),
  });
}

export type McpServerDto = {
  id: string;
  name: string;
  label: string;
  description: string | null;
  serverUrl: string;
  hasBearer: boolean;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
};

export function useMcpServers() {
  return useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () =>
      api<{ servers: McpServerDto[] }>("/api/mcp-servers").then((r) => r.servers),
  });
}

export type SecretRow = { key: string; configured: boolean };

export function useSecrets() {
  return useQuery({
    queryKey: ["secrets"],
    queryFn: () => api<{ secrets: SecretRow[] }>("/api/secrets").then((r) => r.secrets),
  });
}

export type AppSettingRow = { key: string; value: string | null };

export const DEFAULT_PRODUCT_NAME = "open-agents";

export type PublicBrandingSettings = {
  productName: string;
  faviconUrl: string | null;
  sidebarLogoUrl: string | null;
};

export function assetSrc(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/static/")) return trimmed;
  return undefined;
}

export function useAppSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{ settings: AppSettingRow[] }>("/api/settings").then((r) => r.settings),
  });
}

export function usePublicBranding() {
  return useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => api<PublicBrandingSettings>("/api/settings/public"),
    staleTime: 60_000,
  });
}

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  banned: boolean;
  createdAt: string;
};

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ users: UserRow[] }>("/api/users").then((r) => r.users),
  });
}

export type ConversationListItem = {
  id: string;
  title: string;
  agent: { id: string; slug: string; displayName: string; avatar: string | null };
  updatedAt: string;
};

export function useConversations(agentSlug?: string) {
  return useQuery({
    queryKey: ["conversations", { agentSlug: agentSlug ?? null }],
    queryFn: () => {
      const url = agentSlug
        ? `/api/conversations?agentSlug=${encodeURIComponent(agentSlug)}`
        : "/api/conversations";
      return api<{ conversations: ConversationListItem[] }>(url).then(
        (r) => r.conversations,
      );
    },
  });
}

export type ChatAttachmentSummary = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  runId: string | null;
  createdAt: string;
  attachments: ChatAttachmentSummary[];
};

export type RunAttachmentSummary = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

/**
 * Files the agent attached during a run via `attach_run_file`. Used by the
 * chat UI to render downloadable links on the assistant message bubble.
 */
export function useRunAttachments(runId: string | null | undefined) {
  return useQuery({
    enabled: Boolean(runId),
    queryKey: ["runs", runId, "attachments"],
    queryFn: () =>
      api<{ attachments: RunAttachmentSummary[] }>(`/api/runs/${runId}/attachments`).then(
        (r) => r.attachments,
      ),
  });
}

export function runAttachmentDownloadUrl(runId: string, attachmentId: string): string {
  return `/api/runs/${runId}/attachments/${attachmentId}`;
}

export type ConversationDetail = {
  id: string;
  title: string;
  agent: { id: string; slug: string; displayName: string; avatar: string | null };
  messages: ChatMessage[];
};

export function useConversation(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ["conversations", id],
    queryFn: () => api<ConversationDetail>(`/api/conversations/${id}`),
  });
}

export type IssueSurface = "chat" | "email" | "workflow";
export type IssueStatus = "open" | "resolved";

export type IssueListItem = {
  id: string;
  surface: IssueSurface;
  status: IssueStatus;
  description: string;
  reporterEmail: string;
  reporterUserId: string | null;
  reporterName: string | null;
  agent: { id: string; slug: string; displayName: string; avatar: string | null } | null;
  workflow: { id: string; slug: string; displayName: string } | null;
  conversationId: string | null;
  threadId: string | null;
  workflowConversationId: string | null;
  sessionLabel: string;
  createdAt: string;
  resolvedAt: string | null;
};

export function useIssues(status?: IssueStatus) {
  return useQuery({
    queryKey: ["issues", { status: status ?? null }],
    queryFn: () => {
      const url = status
        ? `/api/issues?status=${encodeURIComponent(status)}`
        : "/api/issues";
      return api<{ issues: IssueListItem[] }>(url).then((r) => r.issues);
    },
  });
}

export type IssueDetailRunEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: unknown;
};

export type IssueDetailRunSkill = {
  skillId: string;
  skillVersionId: string;
  name: string;
  slug: string;
  versionNumber: number;
  sandboxPath: string;
  status: "materialized" | "skipped" | "missing" | "invalid";
  fileCount?: number;
  error?: string;
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
  surface: IssueSurface;
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
  runtime: ToolRuntime;
  deprecated: boolean;
};

export type IssueDetailSkillBinding = {
  bindingId: string;
  skillId: string;
  skillVersionId: string;
  name: string;
  versionNumber: number;
};

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

/** Agent trace payload (chat/email session) without issue metadata. */
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

export type IssueMetadata = {
  id: string;
  status: IssueStatus;
  description: string;
  reporterEmail: string;
  reporterUserId: string | null;
  reporterName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolvedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssueDetail = IssueMetadata & (SessionTrace | WorkflowTrace);

export function useConversationTrace(conversationId: string | undefined) {
  return useQuery({
    enabled: Boolean(conversationId),
    queryKey: ["conversations", conversationId, "trace"],
    queryFn: () => api<SessionTrace>(`/api/conversations/${conversationId}/trace`),
  });
}

export function useWorkflowConversationTrace(conversationId: string | undefined) {
  return useQuery({
    enabled: Boolean(conversationId),
    queryKey: ["workflow-conversations", conversationId, "trace"],
    queryFn: () =>
      api<WorkflowTrace>(`/api/workflow-conversations/${conversationId}/trace`),
  });
}

export function useIssue(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ["issues", id],
    queryFn: () => api<IssueDetail>(`/api/issues/${id}`),
  });
}

export type SandboxSummary = {
  id: string;
  provider: string;
  providerSandboxId: string;
  sessionId: string;
  state: string;
  agentId: string;
  agentSlug?: string;
  agentDisplayName?: string;
  surface: "chat" | "email" | null;
  conversationId: string | null;
  conversationTitle: string | null;
  threadId: string | null;
  threadSubject: string | null;
  lifecyclePolicy: {
    autoStopInterval: number;
    autoArchiveInterval: number;
    autoDeleteInterval: number;
  };
  lastActivityAt: string;
  lastSyncedAt: string | null;
  errorReason: string | null;
  recoverable: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export function useSandboxes(state?: string) {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  const qs = params.toString();
  return useQuery({
    queryKey: ["sandboxes", state ?? "all"],
    queryFn: () =>
      api<{ sandboxes: SandboxSummary[]; total: number }>(
        `/api/sandboxes${qs ? `?${qs}` : ""}`,
      ),
  });
}

export function useSandboxOrphans() {
  return useQuery({
    queryKey: ["sandboxes", "orphans"],
    queryFn: () =>
      api<{
        orphans: Array<{
          providerSandboxId: string;
          state: string;
          agentId?: string;
        }>;
      }>("/api/sandboxes/orphans"),
  });
}

export type McpConnectionTokenSummary = {
  id: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  ipAddress: string | null;
};

export function useMcpConnectionInfo() {
  return useQuery({
    queryKey: ["mcp-connection", "info"],
    queryFn: () => api<McpConnectionInfo>("/api/mcp-connection/info"),
    staleTime: 60_000,
  });
}

export function useMcpConnectionTokens() {
  return useQuery({
    queryKey: ["mcp-connection", "tokens"],
    queryFn: async (): Promise<McpConnectionTokenSummary[]> => {
      const body = await api<{ tokens: McpConnectionTokenSummary[] }>(
        "/api/mcp-connection/tokens",
      );
      return body.tokens;
    },
  });
}

export function useConversationSandbox(conversationId: string | undefined) {
  return useQuery({
    enabled: Boolean(conversationId),
    queryKey: ["sandboxes", "conversation", conversationId],
    queryFn: () =>
      api<{ sandbox: SandboxSummary | null }>(
        `/api/sandboxes/by-conversation/${conversationId}`,
      ),
  });
}
