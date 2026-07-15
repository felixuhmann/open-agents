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
  AiConversationDownload,
  type PendingUpload,
} from "@/components/chat/AiChat";
import { AgentRunActivity } from "@/components/chat/AgentRunActivity";
import { useAgentRunStream } from "@/components/chat/useAgentRunStream";
import { ReportIssueDialog } from "@/components/chat/ReportIssueDialog";
import { AssistantRunAttachments } from "@/components/chat/AssistantRunAttachments";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type OptimisticMessage = {
  text: string;
  attachments: ChatAttachmentSummary[];
};

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

  const runState = useAgentRunStream({
    runId: activeRunId,
    eventUrl: activeRunId ? `/api/runs/${activeRunId}/events` : null,
    onTerminal: (event, finishedRunId) => {
      setActiveRunId(null);
      setStoppingRunId(null);
      void qc.invalidateQueries({ queryKey: ["conversations", conversationId] });
      void qc.invalidateQueries({
        queryKey: ["runs", finishedRunId, "attachments"],
      });
      if (event.type === "run.failed") {
        toast.error("Run failed", {
          description:
            typeof event.payload.error === "string"
              ? event.payload.error
              : "The agent stopped unexpectedly.",
        });
      }
    },
  });

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
  const empty = messages.length === 0 && !runState.text && !showOptimistic && !sending;

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

                <AgentRunActivity state={runState} running={Boolean(activeRunId)} />
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
