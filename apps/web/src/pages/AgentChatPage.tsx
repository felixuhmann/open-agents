import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChatCircleDotsIcon,
  DownloadSimpleIcon,
  FileIcon,
  PaperclipIcon,
  PaperPlaneTiltIcon,
  RobotIcon,
  UserIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  avatarSrc,
  type ChatAttachmentSummary,
  type ChatMessage,
  runAttachmentDownloadUrl,
  useAgent,
  useConversation,
  useRunAttachments,
} from "@/lib/queries";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";

type StreamEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type PendingUpload = {
  chatAttachmentId: string;
  chatMessageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export default function AgentChatPage() {
  const { slug, conversationId } = useParams<{
    slug: string;
    conversationId?: string;
  }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const agent = useAgent(slug);
  const conversation = useConversation(conversationId);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [toolCalls, setToolCalls] = useState<Array<{ seq: number; toolName: string }>>(
    [],
  );
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.data, streamingText]);

  // A pending upload requires a conversationId because the upload route
  // is `/conversations/:id/attachments`. If the page is on the "new chat"
  // route (no conversationId yet) we'd have to provision the conversation
  // up front before the user can attach a file. Doing that here keeps the
  // flow uniform: first upload click creates the conversation, subsequent
  // uploads reuse it. The initial send then just posts the message into
  // the already-existing conversation.
  const ensureConversationId = async (): Promise<string> => {
    if (conversationId) return conversationId;
    if (!slug) throw new Error("missing agent slug");
    const conv = await api<{ id: string }>("/api/conversations", {
      json: { agentSlug: slug },
    });
    void navigate(`/agents/${slug}/chat/${conv.id}`, { replace: true });
    return conv.id;
  };

  const createConversation = useMutation({
    mutationFn: async (input: { agentSlug: string; firstMessage: string }) => {
      const conv = await api<{ id: string }>("/api/conversations", {
        json: { agentSlug: input.agentSlug },
      });
      const sent = await api<{ messageId: string; runId: string }>(
        `/api/conversations/${conv.id}/messages`,
        { json: { text: input.firstMessage } },
      );
      return { conversationId: conv.id, runId: sent.runId };
    },
    onSuccess: ({ conversationId: cid, runId }) => {
      void navigate(`/agents/${slug}/chat/${cid}`);
      setActiveRunId(runId);
    },
    onError: (e) =>
      toast.error("Couldn't start conversation", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const sendMessage = useMutation({
    mutationFn: (text: string) =>
      api<{ messageId: string; runId: string }>(
        `/api/conversations/${conversationId}/messages`,
        { json: { text } },
      ),
    onSuccess: async (res) => {
      setActiveRunId(res.runId);
      setPendingUploads([]);
      await qc.invalidateQueries({ queryKey: ["conversations", conversationId] });
    },
    onError: (e) =>
      toast.error("Couldn't send message", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items = Array.from(files);
    setUploadingCount((n) => n + items.length);
    try {
      const cid = await ensureConversationId();
      for (const file of items) {
        if (file.size === 0) {
          toast.error(`${file.name}: empty file, skipped`);
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(`${file.name}: too large (>25 MB)`);
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch(`/conversations/${cid}/attachments`, {
            method: "POST",
            credentials: "include",
            body: form,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new ApiError(res.status, text || res.statusText);
          }
          const body = (await res.json()) as {
            chatMessageId: string;
            chatAttachmentId: string;
            filename: string;
            contentType: string;
            sizeBytes: number;
          };
          setPendingUploads((prev) => [
            ...prev,
            {
              chatMessageId: body.chatMessageId,
              chatAttachmentId: body.chatAttachmentId,
              filename: body.filename,
              contentType: body.contentType,
              sizeBytes: body.sizeBytes,
            },
          ]);
        } catch (err) {
          toast.error(`${file.name}: upload failed`, {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      toast.error("Couldn't stage uploads", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingCount((n) => Math.max(0, n - items.length));
    }
  };

  // The placeholder ChatMessage row stays on the server until the next
  // `POST /:id/messages` reparents+deletes it; that's fine because
  // pending_user_upload rows are filtered out of the conversations GET.
  const removePendingUpload = (item: PendingUpload) => {
    setPendingUploads((prev) =>
      prev.filter((p) => p.chatAttachmentId !== item.chatAttachmentId),
    );
  };

  useEffect(() => {
    if (!activeRunId) return;
    setStreamingText("");
    setToolCalls([]);
    const url = `/api/runs/${activeRunId}/events`;
    const source = new EventSource(url, { withCredentials: true });
    let buffer = "";
    const handle = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        if (data.type === "agent.message" && typeof data.payload.text === "string") {
          buffer = data.payload.text;
          setStreamingText(buffer);
        } else if (
          data.type === "tool.use" &&
          typeof data.payload.toolName === "string"
        ) {
          setToolCalls((prev) => [
            ...prev,
            { seq: data.seq, toolName: data.payload.toolName as string },
          ]);
        } else if (data.type === "run.succeeded" || data.type === "run.failed") {
          source.close();
          const finishedRunId = activeRunId;
          setActiveRunId(null);
          setStreamingText("");
          setToolCalls([]);
          void qc.invalidateQueries({
            queryKey: ["conversations", conversationId],
          });
          if (finishedRunId) {
            void qc.invalidateQueries({
              queryKey: ["runs", finishedRunId, "attachments"],
            });
          }
          if (data.type === "run.failed") {
            const errPayload = data.payload as { error?: string };
            toast.error("Run failed", {
              description: errPayload.error ?? "The agent stopped unexpectedly.",
            });
          }
        }
      } catch (err) {
        console.warn("SSE parse error", err);
      }
    };
    source.addEventListener("agent.message", handle as EventListener);
    source.addEventListener("agent.delta", handle as EventListener);
    source.addEventListener("tool.use", handle as EventListener);
    source.addEventListener("tool.result", handle as EventListener);
    source.addEventListener("run.started", handle as EventListener);
    source.addEventListener("run.succeeded", handle as EventListener);
    source.addEventListener("run.failed", handle as EventListener);
    source.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => source.close();
  }, [activeRunId, conversationId, qc]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    // Allow attachment-only sends — but require some text so Anthropic has
    // a non-empty user message to respond to. Default it if the user only
    // attached files and pressed enter.
    const text = trimmed || (pendingUploads.length > 0 ? "(see attached files)" : "");
    if (!text || !slug) return;
    if (!conversationId) {
      // With pending uploads we must already have a conversationId because
      // ensureConversationId() created one before the first upload.
      createConversation.mutate({ agentSlug: slug, firstMessage: text });
    } else {
      sendMessage.mutate(text);
    }
    setDraft("");
  };

  if (!agent.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const messages: ChatMessage[] = conversation.data?.messages ?? [];
  const sending =
    createConversation.isPending || sendMessage.isPending || Boolean(activeRunId);
  const empty = messages.length === 0 && !streamingText;
  const initials = agent.data.displayName.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      <header className="flex items-center gap-3">
        <Avatar className="size-9 rounded-none">
          {agent.data.avatar ? (
            <AvatarImage
              className="rounded-none"
              src={avatarSrc(agent.data.avatar)}
              alt={agent.data.displayName}
            />
          ) : null}
          <AvatarFallback className="rounded-none bg-primary text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-semibold leading-tight">
            {agent.data.displayName}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.data?.title ?? "New conversation"}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col border bg-card">
        <ScrollArea className="min-h-0 flex-1 px-4 py-4">
          {empty ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ChatCircleDotsIcon />
                </EmptyMedia>
                <EmptyTitle>Start the conversation</EmptyTitle>
                <EmptyDescription>
                  Send a message below and {agent.data.displayName} will respond.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <Bubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  runId={m.runId}
                  attachments={m.attachments}
                  agentInitials={initials}
                  agentDisplayName={agent.data.displayName}
                  agentAvatar={agent.data.avatar}
                />
              ))}
              {toolCalls.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {toolCalls.map((tc) => (
                    <Badge key={tc.seq} variant="secondary" className="font-mono">
                      <WrenchIcon data-icon="inline-start" />
                      {tc.toolName}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {streamingText ? (
                <Bubble
                  role="assistant"
                  content={streamingText}
                  agentInitials={initials}
                  agentDisplayName={agent.data.displayName}
                  agentAvatar={agent.data.avatar}
                  pending
                />
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>
      </div>

      <form onSubmit={submit} className="flex shrink-0 flex-col gap-2">
        {pendingUploads.length > 0 || uploadingCount > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {pendingUploads.map((u) => (
              <Badge
                key={u.chatAttachmentId}
                variant="secondary"
                className="gap-1.5 pr-1 font-mono"
              >
                <PaperclipIcon data-icon="inline-start" />
                <span className="max-w-[18rem] truncate" title={u.filename}>
                  {u.filename}
                </span>
                <span className="text-muted-foreground">{formatBytes(u.sizeBytes)}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-5"
                  aria-label={`Remove ${u.filename}`}
                  onClick={() => removePendingUpload(u)}
                  disabled={sending}
                >
                  <XIcon className="size-3" />
                </Button>
              </Badge>
            ))}
            {uploadingCount > 0 ? (
              <Badge variant="outline" className="gap-1.5 font-mono">
                <Spinner className="size-3" />
                Uploading {uploadingCount}…
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = e.target.files;
              void handleFilePick(files);
              if (e.target) e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={sending || uploadingCount > 0}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
          >
            <PaperclipIcon />
          </Button>
          <Textarea
            rows={2}
            className="flex-1 resize-none"
            placeholder="Type a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            disabled={sending}
          />
          <Button
            type="submit"
            size="lg"
            disabled={
              sending ||
              uploadingCount > 0 ||
              (!draft.trim() && pendingUploads.length === 0)
            }
          >
            {sending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PaperPlaneTiltIcon data-icon="inline-start" />
            )}
            {sending ? "Sending" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Bubble({
  role,
  content,
  runId,
  attachments,
  agentInitials,
  agentDisplayName,
  agentAvatar,
  pending,
}: {
  role: string;
  content: string;
  runId?: string | null;
  attachments?: ChatAttachmentSummary[];
  agentInitials: string;
  agentDisplayName: string;
  agentAvatar: string | null;
  pending?: boolean;
}) {
  const mine = role === "user";
  const isSystem = role === "system";
  const showAgentImage = !mine && !isSystem && Boolean(agentAvatar);
  const userAttachments = attachments ?? [];
  return (
    <div
      className={cn(
        "flex w-full items-start gap-3",
        mine ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar className="size-7 shrink-0 rounded-none">
        {showAgentImage ? (
          <AvatarImage
            className="rounded-none"
            src={avatarSrc(agentAvatar)}
            alt={agentDisplayName}
          />
        ) : null}
        <AvatarFallback
          className={cn(
            "rounded-none text-[10px]",
            mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          )}
        >
          {mine ? <UserIcon className="size-3.5" /> : <RobotIcon className="size-3.5" />}
          {!mine && !isSystem ? <span className="sr-only">{agentInitials}</span> : null}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-2",
          mine ? "items-end" : "items-start",
        )}
      >
        {content ? (
          <div
            className={cn(
              "px-3 py-2 text-sm leading-relaxed",
              mine || isSystem ? "whitespace-pre-wrap" : null,
              mine
                ? "bg-primary text-primary-foreground"
                : isSystem
                  ? "bg-muted/50 text-muted-foreground italic"
                  : "bg-muted text-foreground",
              pending && "opacity-80",
            )}
          >
            {mine || isSystem ? content : <Markdown>{content}</Markdown>}
          </div>
        ) : null}
        {userAttachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {userAttachments.map((a) => (
              <span
                key={a.id}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 text-xs",
                  mine
                    ? "bg-primary/15 text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                <PaperclipIcon className="size-3" />
                <span className="max-w-[18rem] truncate" title={a.filename}>
                  {a.filename}
                </span>
                <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
              </span>
            ))}
          </div>
        ) : null}
        {!mine && !isSystem && runId ? <AssistantRunAttachments runId={runId} /> : null}
      </div>
    </div>
  );
}

function AssistantRunAttachments({ runId }: { runId: string }) {
  const q = useRunAttachments(runId);
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a) => (
        <a
          key={a.id}
          href={runAttachmentDownloadUrl(runId, a.id)}
          download={a.filename}
          className="inline-flex items-center gap-1.5 border bg-card px-2 py-1 text-xs hover:bg-muted"
        >
          <FileIcon className="size-3.5" />
          <span className="max-w-[18rem] truncate" title={a.filename}>
            {a.filename}
          </span>
          <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
          <DownloadSimpleIcon className="size-3.5" />
        </a>
      ))}
    </div>
  );
}
