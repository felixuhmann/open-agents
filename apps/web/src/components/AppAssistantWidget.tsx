import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChatsCircleIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import {
  avatarSrc,
  type ChatMessage as ChatMessageData,
  useAppAssistant,
  useConversation,
} from "@/lib/queries";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Composer } from "@/components/chat/Composer";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";

const CONVERSATION_STORAGE_KEY = "open-agents-app-assistant-conversation-id";

const OPERATOR_STARTERS = [
  "List all agents in this deployment",
  "Create a new agent for internal IT support",
  "Which agents have web chat enabled?",
];

const MEMBER_STARTERS = [
  "What can you help me with in Open Agents?",
  "How do I start a chat with an agent?",
];

type StreamEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type LiveToolCall = { callId: string; toolName: string; output: string; done: boolean };

type Props = {
  className?: string;
};

export function AppAssistantWidget({ className }: Props) {
  const assistant = useAppAssistant();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(CONVERSATION_STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const conversation = useConversation(conversationId);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [toolCalls, setToolCalls] = useState<LiveToolCall[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const agentSlug = assistant.data?.agentSlug;
  const ready = assistant.data?.ready ?? false;
  const displayName = assistant.data?.displayName ?? "Assistant";
  const canManage = assistant.data?.canManageAgents ?? false;
  const starters = canManage ? OPERATOR_STARTERS : MEMBER_STARTERS;

  const messages: ChatMessageData[] = useMemo(
    () => conversation.data?.messages ?? [],
    [conversation.data],
  );

  const isStreaming = Boolean(activeRunId);
  const initials = displayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!conversationId) return;
    try {
      localStorage.setItem(CONVERSATION_STORAGE_KEY, conversationId);
    } catch {
      // ignore quota errors
    }
  }, [conversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, toolCalls, optimistic, open]);

  const createConversation = useMutation({
    mutationFn: async (text: string) => {
      if (!agentSlug) throw new Error("assistant not configured");
      const conv = await api<{ id: string }>("/api/conversations", {
        json: { agentSlug, firstMessage: text },
      });
      const sent = await api<{ messageId: string; runId: string }>(
        `/api/conversations/${conv.id}/messages`,
        { json: { text } },
      );
      return { conversationId: conv.id, runId: sent.runId };
    },
    onSuccess: ({ conversationId: cid, runId }) => {
      setConversationId(cid);
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
    onSuccess: (res) => {
      setActiveRunId(res.runId);
      void qc.invalidateQueries({ queryKey: ["conversations", conversationId] });
    },
    onError: (e) => {
      setOptimistic(null);
      toast.error("Couldn't send message", {
        description: e instanceof ApiError ? e.message : String(e),
      });
    },
  });

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
                toolName: data.payload.toolName as string,
                output: "",
                done: false,
              },
            ];
          });
        } else if (data.type === "run.succeeded" || data.type === "run.failed") {
          source.close();
          setActiveRunId(null);
          setStreamingText("");
          setToolCalls([]);
          setOptimistic(null);
          void qc.invalidateQueries({ queryKey: ["conversations", conversationId] });
          if (data.type === "run.failed") {
            const err =
              typeof data.payload.error === "string" ? data.payload.error : "Run failed";
            toast.error("Assistant run failed", { description: err });
          }
        }
      } catch {
        // ignore malformed SSE payloads
      }
    };
    source.onmessage = handle;
    source.onerror = () => {
      source.close();
      setActiveRunId(null);
    };
    return () => source.close();
  }, [activeRunId, conversationId, qc]);

  const onSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !ready || isStreaming) return;
    setOptimistic(trimmed);
    setDraft("");
    if (!conversationId) {
      createConversation.mutate(trimmed);
    } else {
      sendMessage.mutate(trimmed);
    }
  };

  const onNewChat = () => {
    setConversationId(undefined);
    try {
      localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setOptimistic(null);
    setDraft("");
  };

  if (assistant.isLoading || !assistant.data) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2",
        className,
      )}
    >
      {open ? (
        <div
          className="pointer-events-auto flex w-[min(100vw-2rem,24rem)] flex-col overflow-hidden border border-border bg-background shadow-lg sm:w-[26rem]"
          style={{ maxHeight: "min(32rem, calc(100vh - 6rem))" }}
          role="dialog"
          aria-label="Open Agents assistant"
        >
          <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
            <Avatar className="size-8 border border-border">
              {assistant.data.avatar ? (
                <AvatarImage src={avatarSrc(assistant.data.avatar)} alt="" />
              ) : null}
              <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {ready
                  ? canManage
                    ? "Can manage agents"
                    : "Ask about the platform"
                  : "Not ready — publish the app-assistant agent"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onNewChat}
              disabled={!conversationId}
              title="New chat"
            >
              <span className="sr-only">New chat</span>
              <span className="text-xs font-medium">New</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <XIcon className="size-4" />
            </Button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {!ready ? (
              <p className="text-sm text-muted-foreground">
                The app assistant is not configured yet. An admin should restart the API
                after upgrade so the <code className="text-xs">app-assistant</code> agent
                is seeded and published.
              </p>
            ) : messages.length === 0 && !optimistic && !streamingText ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-muted-foreground">
                  Chat with Open Agents to explore the control plane
                  {canManage ? " and manage agents" : ""}.
                </p>
                <div className="flex flex-col gap-1.5">
                  {starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onSend(s)}
                      disabled={isStreaming}
                      className="border border-border bg-card px-2.5 py-2 text-left text-xs hover:bg-muted/60"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    createdAt={m.createdAt}
                    agentDisplayName={displayName}
                    agentAvatar={assistant.data.avatar}
                  />
                ))}
                {optimistic ? (
                  <ChatMessage
                    role="user"
                    content={optimistic}
                    agentDisplayName={displayName}
                    agentAvatar={assistant.data.avatar}
                  />
                ) : null}
                {toolCalls.map((tc) => (
                  <ToolCallCard
                    key={tc.callId}
                    toolName={tc.toolName}
                    output={tc.output}
                    running={!tc.done}
                  />
                ))}
                {streamingText ? (
                  <div className="flex gap-2">
                    <Avatar className="mt-0.5 size-7 shrink-0 border border-border">
                      <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 text-sm">
                      <Markdown>{streamingText}</Markdown>
                    </div>
                  </div>
                ) : null}
                {isStreaming && !streamingText && toolCalls.length === 0 ? (
                  <TypingIndicator />
                ) : null}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t p-2">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => onSend(draft)}
              onFiles={() => undefined}
              pendingUploads={[]}
              onRemoveUpload={() => undefined}
              uploadingCount={0}
              sending={!ready || isStreaming}
              placeholder={ready ? "Message the assistant…" : "Assistant unavailable"}
            />
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        size="icon"
        className="pointer-events-auto size-14 rounded-full shadow-lg"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? (
          <XIcon className="size-6" />
        ) : (
          <ChatsCircleIcon className="size-6" weight="fill" />
        )}
      </Button>
    </div>
  );
}
