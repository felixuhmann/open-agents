import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ClockCounterClockwiseIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  canOperateAgents,
  type ChatAttachmentSummary,
  type ChatMessage as ChatMessageData,
  useAgent,
  useConversation,
  useCurrentUser,
} from "@/lib/queries";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/Markdown";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Composer, type PendingUpload } from "@/components/chat/Composer";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatFileDropZone } from "@/components/chat/ChatFileDropZone";
import { ReportIssueDialog } from "@/components/chat/ReportIssueDialog";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { AssistantRunAttachments } from "@/components/chat/AssistantRunAttachments";

type StreamEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type LiveToolCall = { callId: string; toolName: string; output: string; done: boolean };

type OptimisticMessage = {
  text: string;
  attachments: ChatAttachmentSummary[];
};

function appendToolOutput(
  prev: LiveToolCall[],
  callId: string,
  toolName: string,
  chunk: string,
): LiveToolCall[] {
  const idx = prev.findIndex((tc) => tc.callId === callId);
  if (idx < 0) {
    return [...prev, { callId, toolName, output: chunk, done: false }];
  }
  const next = [...prev];
  const row = next[idx];
  if (!row) return prev;
  next[idx] = { ...row, output: row.output + chunk };
  return next;
}

export default function AgentChatPage() {
  const { slug, conversationId } = useParams<{
    slug: string;
    conversationId?: string;
  }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const agent = useAgent(slug);
  const me = useCurrentUser();
  const conversation = useConversation(conversationId);
  const isOperator = canOperateAgents(me.data?.role);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [toolCalls, setToolCalls] = useState<LiveToolCall[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [optimistic, setOptimistic] = useState<OptimisticMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const messages: ChatMessageData[] = useMemo(
    () => conversation.data?.messages ?? [],
    [conversation.data],
  );

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    atBottomRef.current = near;
    setShowScrollDown(!near);
  };

  // Auto-follow new content only when the reader is already pinned to the
  // bottom, so scrolling up to read history isn't yanked back down.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom("smooth");
  }, [messages, streamingText, toolCalls, optimistic]);

  // Clear the optimistic user echo once the persisted message lands.
  useEffect(() => {
    if (!optimistic) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser && lastUser.content === optimistic.text) {
      setOptimistic(null);
    }
  }, [messages, optimistic]);

  // A pending upload requires a conversationId because the upload route
  // is `/conversations/:id/attachments`. The first upload provisions the
  // conversation so subsequent uploads + the initial send reuse it.
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
        json: { agentSlug: input.agentSlug, firstMessage: input.firstMessage },
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
    onError: (e) => {
      setOptimistic(null);
      toast.error("Couldn't start conversation", {
        description: e instanceof ApiError ? e.message : String(e),
      });
    },
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
    onError: (e) => {
      setOptimistic(null);
      toast.error("Couldn't send message", {
        description: e instanceof ApiError ? e.message : String(e),
      });
    },
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
        if (data.type === "agent.delta" && typeof data.payload.text === "string") {
          buffer += data.payload.text;
          setStreamingText(buffer);
        } else if (
          data.type === "agent.message" &&
          typeof data.payload.text === "string"
        ) {
          buffer = data.payload.text;
          setStreamingText(buffer);
        } else if (
          data.type === "tool.use" &&
          typeof data.payload.toolName === "string"
        ) {
          const callId =
            typeof data.payload.callId === "string"
              ? data.payload.callId
              : `seq-${data.seq}`;
          setToolCalls((prev) => {
            if (prev.some((tc) => tc.callId === callId)) return prev;
            return [
              ...prev,
              {
                callId,
                toolName:
                  typeof data.payload.toolName === "string"
                    ? data.payload.toolName
                    : "tool",
                output: "",
                done: false,
              },
            ];
          });
        } else if (
          data.type === "tool.result" &&
          typeof data.payload.toolName === "string"
        ) {
          const callId =
            typeof data.payload.callId === "string"
              ? data.payload.callId
              : `seq-${data.seq}`;
          const toolName = data.payload.toolName;
          const resultText =
            typeof data.payload.result === "string"
              ? data.payload.result
              : data.payload.result !== undefined
                ? JSON.stringify(data.payload.result, null, 2)
                : data.payload.isError
                  ? "[tool error]"
                  : "";
          setToolCalls((prev) => {
            const idx = prev.findIndex((tc) => tc.callId === callId);
            const normalized =
              resultText && !resultText.endsWith("\n") ? `${resultText}\n` : resultText;
            if (idx < 0) {
              return [...prev, { callId, toolName, output: normalized, done: true }];
            }
            const next = [...prev];
            const row = next[idx];
            if (!row) return prev;
            next[idx] = {
              ...row,
              output: normalized || row.output,
              done: true,
            };
            return next;
          });
        } else if (
          data.type === "tool.output" &&
          typeof data.payload.toolName === "string" &&
          typeof data.payload.text === "string"
        ) {
          const stream = data.payload.stream === "stderr" ? "[stderr] " : "";
          const chunk = `${stream}${data.payload.text}`;
          const toolName =
            typeof data.payload.toolName === "string" ? data.payload.toolName : "";
          if (!toolName) return;
          setToolCalls((prev) => {
            const callId =
              typeof data.payload.callId === "string"
                ? data.payload.callId
                : (prev.findLast((tc) => tc.toolName === toolName)?.callId ??
                  `unknown-${toolName}`);
            return appendToolOutput(prev, callId, toolName, chunk);
          });
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
    source.addEventListener("tool.output", handle as EventListener);
    source.addEventListener("tool.result", handle as EventListener);
    source.addEventListener("run.started", handle as EventListener);
    source.addEventListener("run.succeeded", handle as EventListener);
    source.addEventListener("run.failed", handle as EventListener);
    source.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => source.close();
  }, [activeRunId, conversationId, qc]);

  const submit = () => {
    const trimmed = draft.trim();
    const text = trimmed || (pendingUploads.length > 0 ? "(see attached files)" : "");
    if (!text || !slug) return;
    setOptimistic({
      text,
      attachments: pendingUploads.map((u) => ({
        id: u.chatAttachmentId,
        filename: u.filename,
        contentType: u.contentType,
        sizeBytes: u.sizeBytes,
      })),
    });
    atBottomRef.current = true;
    if (!conversationId) {
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

  const sending =
    createConversation.isPending || sendMessage.isPending || Boolean(activeRunId);
  const showOptimistic = optimistic !== null;
  const empty = messages.length === 0 && !streamingText && !showOptimistic && !sending;
  const waitingFirstToken =
    Boolean(activeRunId) && !streamingText && toolCalls.length === 0;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <header className="flex items-center gap-3 border-b pb-3">
        <AgentAvatar
          avatar={agent.data.avatar}
          displayName={agent.data.displayName}
          className="size-9 border border-border"
          logoClassName="size-[58%]"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-base font-semibold leading-tight">
            {agent.data.displayName}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.data?.title ?? "New conversation"}
          </p>
        </div>
        {conversationId && messages.length > 0 ? (
          <ReportIssueDialog conversationId={conversationId} />
        ) : null}
        {conversationId && isOperator ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/agents/${slug}/chat/${conversationId}/debug`}>
              <TerminalWindowIcon data-icon="inline-start" />
              Debug
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          <Link to={`/agents/${agent.data.slug}/conversations`}>
            <ClockCounterClockwiseIcon data-icon="inline-start" />
            History
          </Link>
        </Button>
      </header>

      <ChatFileDropZone
        className="flex min-h-0 flex-1 flex-col gap-3"
        disabled={sending || uploadingCount > 0}
        onFiles={(files) => void handleFilePick(files)}
      >
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
            {empty ? (
              <ChatEmptyState
                agentDisplayName={agent.data.displayName}
                agentAvatar={agent.data.avatar}
                starterPrompts={agent.data.starterPrompts}
                onPick={(text) => setDraft(text)}
              />
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-1 py-4">
                {messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    createdAt={m.createdAt}
                    attachments={m.attachments}
                    agentDisplayName={agent.data.displayName}
                    agentAvatar={agent.data.avatar}
                    footer={
                      m.role === "assistant" && m.runId ? (
                        <AssistantRunAttachments runId={m.runId} />
                      ) : null
                    }
                  />
                ))}

                {showOptimistic ? (
                  <ChatMessage
                    role="user"
                    content={optimistic.text}
                    attachments={optimistic.attachments}
                    agentDisplayName={agent.data.displayName}
                    agentAvatar={agent.data.avatar}
                  />
                ) : null}

                {streamingText || toolCalls.length > 0 || waitingFirstToken ? (
                  <div className="group/msg flex w-full items-start gap-3">
                    <AgentAvatar
                      avatar={agent.data.avatar}
                      displayName={agent.data.displayName}
                      className="mt-0.5 size-7 shrink-0 border border-border"
                      logoClassName="size-[62%]"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
                      <span className="text-xs font-medium text-muted-foreground">
                        {agent.data.displayName}
                      </span>
                      {toolCalls.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          {toolCalls.map((tc) => (
                            <ToolCallCard
                              key={tc.callId}
                              toolName={tc.toolName}
                              output={tc.output}
                              running={!tc.done}
                            />
                          ))}
                        </div>
                      ) : null}
                      {streamingText ? (
                        <StreamingMarkdown text={streamingText} />
                      ) : waitingFirstToken ? (
                        <TypingIndicator />
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="h-2" />
              </div>
            )}
          </div>

          {showScrollDown ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => scrollToBottom("smooth")}
              aria-label="Scroll to latest"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
            >
              <ArrowDownIcon className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="mx-auto w-full max-w-3xl">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onFiles={(files) => void handleFilePick(files)}
            pendingUploads={pendingUploads}
            onRemoveUpload={removePendingUpload}
            uploadingCount={uploadingCount}
            sending={sending}
            placeholder={`Message ${agent.data.displayName}…`}
          />
        </div>
      </ChatFileDropZone>
    </div>
  );
}

/**
 * Renders streaming markdown with a blinking caret appended so the reply
 * reads as "live" while tokens arrive.
 */
function StreamingMarkdown({ text }: { text: string }) {
  return (
    <div className="streaming-markdown">
      <Markdown>{text}</Markdown>
    </div>
  );
}
