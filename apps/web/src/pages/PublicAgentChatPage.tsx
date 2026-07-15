import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/AgentAvatar";
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
  AiRunAttachments,
  type PendingUpload,
} from "@/components/chat/AiChat";
import { AgentRunActivity } from "@/components/chat/AgentRunActivity";
import { useAgentRunStream } from "@/components/chat/useAgentRunStream";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import type {
  ChatAttachmentSummary,
  ChatMessage as ChatMessageData,
  ConversationDetail,
  RunAttachmentSummary,
} from "@/lib/queries";
import { WarningOctagonIcon } from "@phosphor-icons/react";

type Props = { shareToken: string };

type PublicAgent = {
  slug: string;
  displayName: string;
  description: string | null;
  avatar: string | null;
  starterPrompts: string[];
};

type PublicSession = { conversationId: string; accessToken: string };

type OptimisticMessage = {
  text: string;
  attachments: ChatAttachmentSummary[];
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function publicQuery(shareToken: string, accessToken?: string) {
  const query = new URLSearchParams({ token: shareToken });
  if (accessToken) query.set("access_token", accessToken);
  return query.toString();
}

export default function PublicAgentChatPage({ shareToken }: Props) {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<PublicSession | null>(null);
  const sessionRef = useRef(session);
  const creatingSessionRef = useRef<Promise<PublicSession> | null>(null);
  const [draft, setDraft] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [optimistic, setOptimistic] = useState<OptimisticMessage | null>(null);

  const stopRun = useMutation({
    mutationFn: async (runId: string) => {
      if (!session) throw new Error("Public chat session is unavailable");
      return api<{ runId: string; status: string }>(
        `/api/public/conversations/${session.conversationId}/runs/${runId}/stop?${publicQuery(
          shareToken,
          session.accessToken,
        )}`,
        { method: "POST" },
      );
    },
    onError: (error) => {
      setStoppingRunId(null);
      toast.error("Couldn’t stop the run", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const agent = useQuery({
    enabled: Boolean(slug && shareToken),
    queryKey: ["public-agent", slug, shareToken],
    queryFn: () =>
      api<PublicAgent>(`/api/public/agents/${slug}?${publicQuery(shareToken)}`),
    retry: false,
  });

  const conversation = useQuery({
    enabled: Boolean(session),
    queryKey: ["public-conversation", session?.conversationId],
    queryFn: () => {
      if (!session) throw new Error("missing public chat session");
      return api<ConversationDetail>(
        `/api/public/conversations/${session.conversationId}?${publicQuery(
          shareToken,
          session.accessToken,
        )}`,
      );
    },
    retry: false,
  });

  const messages: ChatMessageData[] = useMemo(
    () => conversation.data?.messages ?? [],
    [conversation.data],
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const ensureSession = async (): Promise<PublicSession> => {
    if (sessionRef.current) return sessionRef.current;
    if (creatingSessionRef.current) return creatingSessionRef.current;
    if (!slug) throw new Error("missing agent slug");
    const promise = api<PublicSession>(
      `/api/public/agents/${slug}/conversations?${publicQuery(shareToken)}`,
      { method: "POST" },
    ).then((created) => {
      sessionRef.current = created;
      setSession(created);
      return created;
    });
    creatingSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      creatingSessionRef.current = null;
    }
  };

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      const current = await ensureSession();
      return api<{ messageId: string; runId: string }>(
        `/api/public/conversations/${current.conversationId}/messages?${publicQuery(
          shareToken,
          current.accessToken,
        )}`,
        { json: { text } },
      );
    },
    onSuccess: (result) => {
      setActiveRunId(result.runId);
      setPendingUploads([]);
      const current = sessionRef.current;
      if (current) {
        void queryClient.invalidateQueries({
          queryKey: ["public-conversation", current.conversationId],
        });
      }
    },
    onError: (error) => {
      setOptimistic(null);
      toast.error("Couldn’t send message", {
        description: error instanceof ApiError ? error.message : String(error),
      });
    },
  });

  useEffect(() => {
    if (!optimistic) return;
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser?.content === optimistic.text) setOptimistic(null);
  }, [messages, optimistic]);

  useEffect(() => {
    const active = conversation.data?.activeRunId;
    if (active && !activeRunId) setActiveRunId(active);
  }, [activeRunId, conversation.data?.activeRunId]);

  const runEventUrl =
    activeRunId && session
      ? `/api/public/conversations/${session.conversationId}/runs/${activeRunId}/events?${publicQuery(
          shareToken,
          session.accessToken,
        )}`
      : null;
  const runState = useAgentRunStream({
    runId: activeRunId,
    eventUrl: runEventUrl,
    onTerminal: (event, finishedRunId) => {
      setActiveRunId(null);
      setStoppingRunId(null);
      if (session) {
        void queryClient.invalidateQueries({
          queryKey: ["public-conversation", session.conversationId],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["public-run-attachments", finishedRunId],
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

  const handleFilePick = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    setUploadingCount((count) => count + selected.length);
    try {
      const current = await ensureSession();
      for (const file of selected) {
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
          const uploaded = await api<PendingUpload>(
            `/api/public/conversations/${current.conversationId}/attachments?${publicQuery(
              shareToken,
              current.accessToken,
            )}`,
            { method: "POST", body: form },
          );
          setPendingUploads((items) => [...items, uploaded]);
        } catch (error) {
          toast.error(`${file.name}: upload failed`, {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      toast.error("Couldn’t start a public chat", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUploadingCount((count) => Math.max(0, count - selected.length));
    }
  };

  const submit = () => {
    const trimmed = draft.trim();
    const text = trimmed || (pendingUploads.length ? "(see attached files)" : "");
    if (!text) return;
    setOptimistic({
      text,
      attachments: pendingUploads.map((upload) => ({
        id: upload.chatAttachmentId,
        filename: upload.filename,
        contentType: upload.contentType,
        sizeBytes: upload.sizeBytes,
      })),
    });
    sendMessage.mutate(text);
    setDraft("");
  };

  const stop = () => {
    if (!activeRunId || stoppingRunId === activeRunId) return;
    setStoppingRunId(activeRunId);
    stopRun.mutate(activeRunId);
  };

  if (agent.isLoading) {
    return (
      <div className="flex h-dvh flex-col gap-3 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    );
  }

  if (!agent.data) {
    return (
      <main className="grid h-dvh place-items-center p-6">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WarningOctagonIcon />
            </EmptyMedia>
            <EmptyTitle>This chat is unavailable</EmptyTitle>
            <EmptyDescription>
              The link is invalid, has been disabled, or the agent is no longer available
              for web chat.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    );
  }

  const sending = sendMessage.isPending || Boolean(activeRunId);
  const empty = messages.length === 0 && !optimistic && !runState.text && !sending;

  return (
    <main className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <AgentAvatar
          avatar={agent.data.avatar}
          displayName={agent.data.displayName}
          className="size-9 border border-border"
        />
        <h1 className="truncate font-heading text-base font-semibold">
          {agent.data.displayName}
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-8 px-4 py-6">
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
                      message.role === "assistant" && message.runId && session ? (
                        <PublicRunAttachments
                          session={session}
                          shareToken={shareToken}
                          runId={message.runId}
                        />
                      ) : null
                    }
                  />
                ))}
                {optimistic ? (
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

        <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-4">
          <AiChatComposer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onFiles={handleFilePick}
            pendingUploads={pendingUploads}
            onRemoveUpload={(upload) =>
              setPendingUploads((items) =>
                items.filter((item) => item.chatAttachmentId !== upload.chatAttachmentId),
              )
            }
            uploadingCount={uploadingCount}
            sending={sending}
            running={Boolean(activeRunId)}
            stopping={stoppingRunId === activeRunId}
            onStop={stop}
            placeholder={`Message ${agent.data.displayName}…`}
          />
        </div>
      </div>
    </main>
  );
}

function PublicRunAttachments({
  session,
  shareToken,
  runId,
}: {
  session: PublicSession;
  shareToken: string;
  runId: string;
}) {
  const query = publicQuery(shareToken, session.accessToken);
  const attachments = useQuery({
    queryKey: ["public-run-attachments", runId],
    queryFn: () =>
      api<{ attachments: RunAttachmentSummary[] }>(
        `/api/public/conversations/${session.conversationId}/runs/${runId}/attachments?${query}`,
      ).then((result) => result.attachments),
  });
  if (!attachments.data?.length) return null;
  return (
    <AiRunAttachments
      attachments={attachments.data.map((attachment) => ({
        ...attachment,
        href: `/api/public/conversations/${session.conversationId}/runs/${runId}/attachments/${attachment.id}?${query}`,
      }))}
    />
  );
}
