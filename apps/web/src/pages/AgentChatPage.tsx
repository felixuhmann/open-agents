import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChatCircleDotsIcon,
  PaperPlaneTiltIcon,
  RobotIcon,
  UserIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { avatarSrc, type ChatMessage, useAgent, useConversation } from "@/lib/queries";
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
import { cn } from "@/lib/utils";

type StreamEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.data, streamingText]);

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
      await qc.invalidateQueries({ queryKey: ["conversations", conversationId] });
    },
    onError: (e) =>
      toast.error("Couldn't send message", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
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
          setActiveRunId(null);
          setStreamingText("");
          setToolCalls([]);
          void qc.invalidateQueries({
            queryKey: ["conversations", conversationId],
          });
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
    if (!draft.trim() || !slug) return;
    if (!conversationId) {
      createConversation.mutate({ agentSlug: slug, firstMessage: draft });
    } else {
      sendMessage.mutate(draft);
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
        <ScrollArea className="flex-1 px-4 py-4">
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

      <form onSubmit={submit} className="flex items-end gap-2">
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
        <Button type="submit" size="lg" disabled={!draft.trim() || sending}>
          {sending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PaperPlaneTiltIcon data-icon="inline-start" />
          )}
          {sending ? "Sending" : "Send"}
        </Button>
      </form>
    </div>
  );
}

function Bubble({
  role,
  content,
  agentInitials,
  agentDisplayName,
  agentAvatar,
  pending,
}: {
  role: string;
  content: string;
  agentInitials: string;
  agentDisplayName: string;
  agentAvatar: string | null;
  pending?: boolean;
}) {
  const mine = role === "user";
  const isSystem = role === "system";
  const showAgentImage = !mine && !isSystem && Boolean(agentAvatar);
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
          "max-w-[80%] whitespace-pre-wrap px-3 py-2 text-sm leading-relaxed",
          mine
            ? "bg-primary text-primary-foreground"
            : isSystem
              ? "bg-muted/50 text-muted-foreground italic"
              : "bg-muted text-foreground",
          pending && "opacity-80",
        )}
      >
        {content}
      </div>
    </div>
  );
}
