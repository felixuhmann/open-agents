import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, DownloadSimpleIcon, FileIcon } from "@phosphor-icons/react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatFileDropZone } from "@/components/chat/ChatFileDropZone";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Composer, type PendingUpload } from "@/components/chat/Composer";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { formatBytes } from "@/components/chat/utils";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
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

type StreamEvent = {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
};

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

function readSession(key: string): PublicSession | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PublicSession>;
    return value.conversationId && value.accessToken
      ? { conversationId: value.conversationId, accessToken: value.accessToken }
      : null;
  } catch {
    return null;
  }
}

export default function PublicAgentChatPage({ shareToken }: Props) {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const storageKey = `public-chat:${slug ?? "unknown"}:${shareToken}`;
  const [session, setSession] = useState<PublicSession | null>(() =>
    readSession(storageKey),
  );
  const sessionRef = useRef(session);
  const creatingSessionRef = useRef<Promise<PublicSession> | null>(null);
  const [draft, setDraft] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [optimistic, setOptimistic] = useState<OptimisticMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);

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
      sessionStorage.setItem(storageKey, JSON.stringify(created));
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
    },
    onError: (error) => {
      setOptimistic(null);
      toast.error("Couldn’t send message", {
        description: error instanceof ApiError ? error.message : String(error),
      });
    },
  });

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  };

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [messages, optimistic, streamingText]);

  useEffect(() => {
    if (!optimistic) return;
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser?.content === optimistic.text) setOptimistic(null);
  }, [messages, optimistic]);

  useEffect(() => {
    if (!activeRunId || !session) return;
    setStreamingText("");
    const url = `/api/public/conversations/${session.conversationId}/runs/${activeRunId}/events?${publicQuery(
      shareToken,
      session.accessToken,
    )}`;
    const source = new EventSource(url);
    let buffer = "";
    const handle = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        if (data.type === "agent.delta" && typeof data.payload.text === "string") {
          buffer += data.payload.text;
          setStreamingText(buffer);
        } else if (
          data.type === "agent.message" &&
          typeof data.payload.text === "string"
        ) {
          buffer = data.payload.text;
          setStreamingText(buffer);
        } else if (data.type === "run.succeeded" || data.type === "run.failed") {
          source.close();
          const finishedRunId = activeRunId;
          setActiveRunId(null);
          setStreamingText("");
          void queryClient.invalidateQueries({
            queryKey: ["public-conversation", session.conversationId],
          });
          void queryClient.invalidateQueries({
            queryKey: ["public-run-attachments", finishedRunId],
          });
          if (data.type === "run.failed") {
            toast.error("The agent stopped unexpectedly");
          }
        }
      } catch {
        // Ignore malformed events; EventSource will keep the durable stream alive.
      }
    };
    source.addEventListener("agent.delta", handle as EventListener);
    source.addEventListener("agent.message", handle as EventListener);
    source.addEventListener("run.succeeded", handle as EventListener);
    source.addEventListener("run.failed", handle as EventListener);
    return () => source.close();
  }, [activeRunId, queryClient, session, shareToken]);

  const handleFilePick = async (files: FileList | null) => {
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
    atBottomRef.current = true;
    sendMessage.mutate(text);
    setDraft("");
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
  const empty = messages.length === 0 && !optimistic && !streamingText && !sending;
  const waitingForReply = Boolean(activeRunId) && !streamingText;

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

      <ChatFileDropZone
        className="flex min-h-0 flex-1 flex-col"
        disabled={sending || uploadingCount > 0}
        onFiles={(files) => void handleFilePick(files)}
      >
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto"
            onScroll={() => {
              const element = scrollRef.current;
              if (!element) return;
              const nearBottom =
                element.scrollHeight - element.scrollTop - element.clientHeight < 80;
              atBottomRef.current = nearBottom;
              setShowScrollDown(!nearBottom);
            }}
          >
            {empty ? (
              <ChatEmptyState
                agentDisplayName={agent.data.displayName}
                agentAvatar={agent.data.avatar}
                starterPrompts={agent.data.starterPrompts}
                onPick={setDraft}
              />
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    createdAt={message.createdAt}
                    attachments={message.attachments}
                    agentDisplayName={agent.data.displayName}
                    agentAvatar={agent.data.avatar}
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
                  <ChatMessage
                    role="user"
                    content={optimistic.text}
                    attachments={optimistic.attachments}
                    agentDisplayName={agent.data.displayName}
                    agentAvatar={agent.data.avatar}
                  />
                ) : null}
                {streamingText || waitingForReply ? (
                  <div className="flex w-full items-start gap-3">
                    <AgentAvatar
                      avatar={agent.data.avatar}
                      displayName={agent.data.displayName}
                      className="mt-0.5 size-7 shrink-0 border border-border"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {agent.data.displayName}
                      </span>
                      {streamingText ? (
                        <div className="streaming-markdown">
                          <Markdown>{streamingText}</Markdown>
                        </div>
                      ) : (
                        <TypingIndicator />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {showScrollDown ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
              aria-label="Scroll to latest"
              onClick={() => scrollToBottom()}
            >
              <ArrowDownIcon />
            </Button>
          ) : null}
        </div>

        <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-4">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onFiles={(files) => void handleFilePick(files)}
            pendingUploads={pendingUploads}
            onRemoveUpload={(upload) =>
              setPendingUploads((items) =>
                items.filter((item) => item.chatAttachmentId !== upload.chatAttachmentId),
              )
            }
            uploadingCount={uploadingCount}
            sending={sending}
            placeholder={`Message ${agent.data.displayName}…`}
          />
        </div>
      </ChatFileDropZone>
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
    <div className="flex flex-wrap gap-1.5">
      {attachments.data.map((attachment) => (
        <a
          key={attachment.id}
          href={`/api/public/conversations/${session.conversationId}/runs/${runId}/attachments/${attachment.id}?${query}`}
          download={attachment.filename}
          className="inline-flex items-center gap-1.5 border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
        >
          <FileIcon />
          <span className="max-w-[18rem] truncate" title={attachment.filename}>
            {attachment.filename}
          </span>
          <span className="text-muted-foreground">
            {formatBytes(attachment.sizeBytes)}
          </span>
          <DownloadSimpleIcon />
        </a>
      ))}
    </div>
  );
}
