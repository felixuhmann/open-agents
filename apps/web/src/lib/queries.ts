import { useQuery } from "@tanstack/react-query";
import type { AgentSummaryDto } from "@open-agents/types";
import { api } from "./api";

export type SetupStatus = { complete: boolean; userCount: number };

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
  role: "admin" | "member";
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

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      api<{ agents: AgentSummaryDto[] }>("/api/agents").then((r) => r.agents),
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
  systemPrompt: string;
  model: string;
  avatar: string | null;
  emailEnabled: boolean;
  webEnabled: boolean;
  accessMode: "everyone" | "specific";
  inboundLocalPart: string;
  anthropicAgentId: string | null;
  environmentId: string | null;
  anthropicAgentVersion: string | null;
  toolBindings: Array<{
    id: string;
    toolId: string;
    tool: { id: string; key: string; name: string; runtime: ToolRuntime };
    configJson: Record<string, unknown>;
  }>;
  skillIds: string[];
  skills: Array<{ id: string; name: string }>;
  thirdPartyMcp: Array<{ id: string; label: string; serverUrl: string }>;
  accessUserIds: string[];
  createdAt: string;
  updatedAt: string;
};

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

export type SkillDto = {
  id: string;
  name: string;
  description: string | null;
  anthropicSkillId: string | null;
  anthropicSkillVersion: string | null;
  createdAt: string;
};

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api<{ skills: SkillDto[] }>("/api/skills").then((r) => r.skills),
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

export function useAppSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{ settings: AppSettingRow[] }>("/api/settings").then((r) => r.settings),
  });
}

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
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
 * Files the agent uploaded back during a run via the signed
 * `REPLY_ATTACHMENT_UPLOAD_URL`. Used by the chat UI to render
 * downloadable links on the assistant message bubble.
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
