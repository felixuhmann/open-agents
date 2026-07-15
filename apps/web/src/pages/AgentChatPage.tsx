import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClockCounterClockwiseIcon, TerminalWindowIcon } from "@phosphor-icons/react";
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
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  AiChatComposer,
  AiChatEmptyState,
  AiChatMessage,
  AiChatPendingMessage,
  AiConversationDownload,
  AiToolCall,
  type PendingUpload,
  type SubagentItem,
} from "@/components/chat/AiChat";
import { ReportIssueDialog } from "@/components/chat/ReportIssueDialog";
import { AssistantRunAttachments } from "@/components/chat/AssistantRunAttachments";

type StreamEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type LiveToolCall = {
  callId: string;
  toolName: string;
  output: string;
  done: boolean;
  /** Redacted tool input from the `tool.use` event, if present. */
  args?: Record<string, unknown>;
  isError?: boolean;
  /** Mirrored child activity, present only for `run_subagent` calls. */
  subagentSlug?: string;
  subagentItems?: SubagentItem[];
};

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

type SubagentInner = {
  kind: string;
  toolName?: string;
  text?: string;
  callId?: string;
  isError?: boolean;
  stream?: "stdout" | "stderr";
  status?: string;
};

/** Fold one mirrored child event into the parent `run_subagent` tool card. */
function applySubagentEvent(
  prev: LiveToolCall[],
  toolCallId: string,
  slug: string,
  inner: SubagentInner,
): LiveToolCall[] {
  const idx = prev.findIndex((tc) => tc.callId === toolCallId);
  if (idx < 0) return prev;
  const row = prev[idx];
  if (!row) return prev;
  const items = [...(row.subagentItems ?? [])];

  const upsertTool = (mut: (tool: Extract<SubagentItem, { type: "tool" }>) => void) => {
    const ti = items.findIndex(
      (it) => it.type === "tool" && it.callId === (inner.callId ?? ""),
    );
    if (ti >= 0) {
      const existing = items[ti] as Extract<SubagentItem, { type: "tool" }>;
      const clone = { ...existing };
      mut(clone);
      items[ti] = clone;
    } else {
      const created: Extract<SubagentItem, { type: "tool" }> = {
        type: "tool",
        callId: inner.callId ?? `sub-${items.length}`,
        toolName: inner.toolName ?? "tool",
        output: "",
        done: false,
      };
      mut(created);
      items.push(created);
    }
  };

  switch (inner.kind) {
    case "tool_use":
      upsertTool(() => {});
      break;
    case "tool_output":
      upsertTool((t) => {
        const prefix = inner.stream === "stderr" ? "[stderr] " : "";
        t.output += `${prefix}${inner.text ?? ""}`;
      });
      break;
    case "tool_result":
      upsertTool((t) => {
        t.done = true;
        if (inner.text) t.output = inner.text;
      });
      break;
    case "message":
      if (inner.text) items.push({ type: "message", text: inner.text });
      break;
    case "session_error":
      if (inner.text) items.push({ type: "message", text: inner.text, isError: true });
      break;
    // run_status is reflected via the parent tool card's running/done state.
  }

  const next = [...prev];
  next[idx] = { ...row, subagentSlug: slug, subagentItems: items };
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
  const [isReasoning, setIsReasoning] = useState(false);
  const [toolCalls, setToolCalls] = useState<LiveToolCall[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [optimistic, setOptimistic] = useState<OptimisticMessage | null>(null);

  const messages: ChatMessageData[] = useMemo(
    () => conversation.data?.messages ?? [],
    [conversation.data],
  );

  useEffect(() => {
    const active = conversation.data?.activeRunId;
    if (active && !activeRunId) setActiveRunId(active);
  }, [activeRunId, conversation.data?.activeRunId]);

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

  const stopRun = useMutation({
    mutationFn: (runId: string) =>
      api<{ runId: string; status: string }>(`/api/runs/${runId}/stop`, {
        method: "POST",
      }),
    onError: (error) => {
      setStoppingRunId(null);
      toast.error("Couldn’t stop the run", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const handleFilePick = async (files: FileList | File[] | null) => {
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
    setIsReasoning(false);
    setToolCalls([]);
    const url = `/api/runs/${activeRunId}/events`;
    const source = new EventSource(url, { withCredentials: true });
    let buffer = "";
    const handle = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        if (data.type === "agent.reasoning" && typeof data.payload.active === "boolean") {
          setIsReasoning(data.payload.active);
        } else if (data.type === "agent.delta" && typeof data.payload.text === "string") {
          setIsReasoning(false);
          buffer += data.payload.text;
          setStreamingText(buffer);
        } else if (
          data.type === "agent.message" &&
          typeof data.payload.text === "string"
        ) {
          setIsReasoning(false);
          buffer = data.payload.text;
          setStreamingText(buffer);
        } else if (
          data.type === "tool.use" &&
          typeof data.payload.toolName === "string"
        ) {
          setIsReasoning(false);
          const callId =
            typeof data.payload.callId === "string"
              ? data.payload.callId
              : `seq-${data.seq}`;
          const args =
            typeof data.payload.args === "object" && data.payload.args !== null
              ? (data.payload.args as Record<string, unknown>)
              : undefined;
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
                args,
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
              return [
                ...prev,
                {
                  callId,
                  toolName,
                  output: normalized,
                  done: true,
                  isError: data.payload.isError === true,
                },
              ];
            }
            const next = [...prev];
            const row = next[idx];
            if (!row) return prev;
            next[idx] = {
              ...row,
              output: normalized || row.output,
              done: true,
              isError: data.payload.isError === true,
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
        } else if (
          data.type === "subagent.event" &&
          typeof data.payload.toolCallId === "string" &&
          typeof data.payload.slug === "string" &&
          data.payload.inner !== null &&
          typeof data.payload.inner === "object"
        ) {
          const toolCallId = data.payload.toolCallId;
          const slug = data.payload.slug;
          const inner = data.payload.inner as SubagentInner;
          setToolCalls((prev) => applySubagentEvent(prev, toolCallId, slug, inner));
        } else if (
          data.type === "run.succeeded" ||
          data.type === "run.failed" ||
          data.type === "run.cancelled"
        ) {
          source.close();
          const finishedRunId = activeRunId;
          setActiveRunId(null);
          setStoppingRunId(null);
          setStreamingText("");
          setIsReasoning(false);
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
    source.addEventListener("agent.reasoning", handle as EventListener);
    source.addEventListener("agent.message", handle as EventListener);
    source.addEventListener("agent.delta", handle as EventListener);
    source.addEventListener("tool.use", handle as EventListener);
    source.addEventListener("tool.output", handle as EventListener);
    source.addEventListener("tool.result", handle as EventListener);
    source.addEventListener("subagent.event", handle as EventListener);
    source.addEventListener("run.started", handle as EventListener);
    source.addEventListener("run.succeeded", handle as EventListener);
    source.addEventListener("run.failed", handle as EventListener);
    source.addEventListener("run.cancelled", handle as EventListener);
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
    if (!conversationId) {
      createConversation.mutate({ agentSlug: slug, firstMessage: text });
    } else {
      sendMessage.mutate(text);
    }
    setDraft("");
  };

  const stop = () => {
    if (!activeRunId || stoppingRunId === activeRunId) return;
    setStoppingRunId(activeRunId);
    stopRun.mutate(activeRunId);
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

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-8 px-1 py-4">
            {empty ? (
              <AiChatEmptyState
                displayName={agent.data.displayName}
                avatar={agent.data.avatar}
                starterPrompts={agent.data.starterPrompts}
                onPick={setDraft}
              />
            ) : (
              <>
                {messages.map((message) => (
                  <AiChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    createdAt={message.createdAt}
                    attachments={message.attachments}
                    footer={
                      message.role === "assistant" && message.runId ? (
                        <AssistantRunAttachments runId={message.runId} />
                      ) : null
                    }
                  />
                ))}

                {showOptimistic ? (
                  <AiChatMessage
                    role="user"
                    content={optimistic.text}
                    attachments={optimistic.attachments}
                  />
                ) : null}

                {streamingText || toolCalls.length > 0 || waitingFirstToken ? (
                  <AiChatPendingMessage
                    text={streamingText}
                    reasoning={isReasoning}
                    waiting={waitingFirstToken}
                    tools={
                      toolCalls.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          {toolCalls.map((toolCall) => (
                            <AiToolCall
                              key={toolCall.callId}
                              toolName={toolCall.toolName}
                              output={toolCall.output}
                              running={!toolCall.done}
                              args={toolCall.args}
                              isError={toolCall.isError}
                              subagentSlug={toolCall.subagentSlug}
                              subagentItems={toolCall.subagentItems}
                            />
                          ))}
                        </div>
                      ) : null
                    }
                  />
                ) : null}
              </>
            )}
          </ConversationContent>
          <AiConversationDownload
            messages={messages}
            filename={`${slug ?? "conversation"}.md`}
          />
          <ConversationScrollButton aria-label="Scroll to latest" />
        </Conversation>

        <div className="mx-auto w-full max-w-3xl">
          <AiChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onFiles={handleFilePick}
            pendingUploads={pendingUploads}
            onRemoveUpload={removePendingUpload}
            uploadingCount={uploadingCount}
            sending={sending}
            running={Boolean(activeRunId)}
            stopping={stoppingRunId === activeRunId}
            onStop={stop}
            placeholder={`Message ${agent.data.displayName}…`}
          />
        </div>
      </div>
    </div>
  );
}
