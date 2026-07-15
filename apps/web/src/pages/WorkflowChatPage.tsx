import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  FlowArrowIcon,
  PencilSimpleIcon,
  SpinnerGapIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  type RunAttachmentSummary,
  canOperateAgents,
  runAttachmentDownloadUrl,
  useCurrentUser,
  useWorkflow,
  useWorkflowConversation,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  AiChatComposer,
  AiChatEmptyState,
  AiChatMessage,
  AiConversationDownload,
  AiRunAttachments,
  AiToolCall,
  type PendingUpload,
} from "@/components/chat/AiChat";
import { ReportIssueDialog } from "@/components/chat/ReportIssueDialog";
import { AssistantRunAttachments } from "@/components/chat/AssistantRunAttachments";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type StreamEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type StepStatus = "pending" | "running" | "succeeded" | "failed";

type LiveToolCall = {
  callId: string;
  toolName: string;
  output: string;
  done: boolean;
  args?: Record<string, unknown>;
};

type WorkflowActivityEvent = {
  key: string;
  seq: number;
  type: string;
  createdAt: string;
  summary: string;
  payload: Record<string, unknown>;
};

type StepState = {
  position: number;
  agentSlug: string;
  agentDisplayName: string;
  status: StepStatus;
  text: string;
  attachments: RunAttachmentSummary[];
  runId: string | null;
  toolCalls: LiveToolCall[];
  events: WorkflowActivityEvent[];
};

export default function WorkflowChatPage() {
  const { slug, conversationId } = useParams<{
    slug: string;
    conversationId?: string;
  }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workflow = useWorkflow(slug);
  const me = useCurrentUser();
  const conversation = useWorkflowConversation(conversationId);
  const [draft, setDraft] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [optimistic, setOptimistic] = useState<{
    text: string;
    attachments: { filename: string; sizeBytes: number }[];
  } | null>(null);
  const isOperator = canOperateAgents(me.data?.role);

  const messages = useMemo(() => conversation.data?.messages ?? [], [conversation.data]);

  useEffect(() => {
    if (!optimistic) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser && lastUser.content === optimistic.text) setOptimistic(null);
  }, [messages, optimistic]);

  const ensureConversationId = async (): Promise<string> => {
    if (conversationId) return conversationId;
    if (!slug) throw new Error("missing workflow slug");
    const conv = await api<{ id: string }>("/api/workflow-conversations", {
      json: { workflowSlug: slug },
    });
    void navigate(`/workflows/${slug}/chat/${conv.id}`, { replace: true });
    return conv.id;
  };

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
          const res = await fetch(`/workflow-conversations/${cid}/attachments`, {
            method: "POST",
            credentials: "include",
            body: form,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new ApiError(res.status, text || res.statusText);
          }
          const body = (await res.json()) as {
            workflowMessageId: string;
            workflowAttachmentId: string;
            filename: string;
            contentType: string;
            sizeBytes: number;
          };
          setPendingUploads((prev) => [
            ...prev,
            {
              chatMessageId: body.workflowMessageId,
              chatAttachmentId: body.workflowAttachmentId,
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

  useEffect(() => {
    const active = conversation.data?.activeWorkflowRunId;
    if (active && !activeRunId) setActiveRunId(active);
  }, [activeRunId, conversation.data?.activeWorkflowRunId]);

  const createConversation = useMutation({
    mutationFn: async (input: { firstMessage: string }) => {
      const conv = await api<{ id: string }>("/api/workflow-conversations", {
        json: { workflowSlug: slug, firstMessage: input.firstMessage },
      });
      const sent = await api<{ messageId: string; workflowRunId: string }>(
        `/api/workflow-conversations/${conv.id}/messages`,
        { json: { text: input.firstMessage } },
      );
      return { conversationId: conv.id, workflowRunId: sent.workflowRunId };
    },
    onSuccess: ({ conversationId: cid, workflowRunId }) => {
      void navigate(`/workflows/${slug}/chat/${cid}`);
      setActiveRunId(workflowRunId);
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
      api<{ messageId: string; workflowRunId: string }>(
        `/api/workflow-conversations/${conversationId}/messages`,
        { json: { text } },
      ),
    onSuccess: async (res) => {
      setActiveRunId(res.workflowRunId);
      setPendingUploads([]);
      await qc.invalidateQueries({
        queryKey: ["workflow-conversations", conversationId],
      });
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
    setSteps([]);
    const url = `/api/workflow-runs/${activeRunId}/events`;
    const source = new EventSource(url, { withCredentials: true });

    const handle = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        const p = data.payload;
        if (data.type === "workflow.run.started" && Array.isArray(p.steps)) {
          const descriptors = p.steps as Array<{
            position: number;
            agentSlug: string;
            agentDisplayName: string;
          }>;
          setSteps(
            descriptors.map((d) => ({
              position: d.position,
              agentSlug: d.agentSlug,
              agentDisplayName: d.agentDisplayName,
              status: "pending",
              text: "",
              attachments: [],
              runId: null,
              toolCalls: [],
              events: [],
            })),
          );
        } else if (data.type === "workflow.step.started") {
          const pos = p.position as number;
          const event = toActivityEvent(data);
          setSteps((prev) =>
            prev.map((s) =>
              s.position === pos
                ? {
                    ...s,
                    status: "running",
                    runId: (p.runId as string) ?? null,
                    events: [...s.events, event],
                  }
                : s,
            ),
          );
        } else if (data.type === "workflow.step.delta") {
          const pos = p.position as number;
          const text = (p.text as string) ?? "";
          setSteps((prev) =>
            prev.map((s) => (s.position === pos ? { ...s, text: s.text + text } : s)),
          );
        } else if (data.type === "workflow.step.succeeded") {
          const pos = p.position as number;
          const output = (p.output as string) ?? "";
          const attachments = (p.attachments as RunAttachmentSummary[]) ?? [];
          const event = toActivityEvent(data);
          setSteps((prev) =>
            prev.map((s) =>
              s.position === pos
                ? {
                    ...s,
                    status: "succeeded",
                    text: output || s.text,
                    attachments,
                    runId: (p.runId as string) ?? s.runId,
                    toolCalls: s.toolCalls.map((tc) => ({ ...tc, done: true })),
                    events: [...s.events, event],
                  }
                : s,
            ),
          );
        } else if (data.type === "workflow.step.tool") {
          const pos = p.position as number;
          const toolName = (p.toolName as string) || "tool";
          const status = p.status === "end" ? "end" : "start";
          const toolArgs =
            typeof p.args === "object" && p.args !== null
              ? (p.args as Record<string, unknown>)
              : undefined;
          const event = toActivityEvent(data);
          setSteps((prev) =>
            prev.map((s) => {
              if (s.position !== pos) return s;
              return {
                ...s,
                events: [...s.events, event],
                toolCalls:
                  status === "start"
                    ? [
                        ...s.toolCalls,
                        {
                          callId: `workflow-${pos}-${data.seq}`,
                          toolName,
                          output: "",
                          done: false,
                          args: toolArgs,
                        },
                      ]
                    : finishLatestToolCall(s.toolCalls, toolName),
              };
            }),
          );
        } else if (data.type === "workflow.run.succeeded") {
          source.close();
          setActiveRunId(null);
          void qc.invalidateQueries({
            queryKey: ["workflow-conversations", conversationId],
          });
        } else if (data.type === "workflow.run.failed") {
          source.close();
          const pos = p.position as number | null;
          if (typeof pos === "number") {
            const event = toActivityEvent(data);
            setSteps((prev) =>
              prev.map((s) =>
                s.position === pos
                  ? {
                      ...s,
                      status: "failed",
                      toolCalls: s.toolCalls.map((tc) => ({ ...tc, done: true })),
                      events: [...s.events, event],
                    }
                  : s,
              ),
            );
          }
          setActiveRunId(null);
          toast.error("Workflow run failed", {
            description: (p.error as string) ?? "A step stopped unexpectedly.",
          });
          void qc.invalidateQueries({
            queryKey: ["workflow-conversations", conversationId],
          });
        }
      } catch (err) {
        console.warn("workflow SSE parse error", err);
      }
    };

    for (const type of [
      "workflow.run.started",
      "workflow.step.started",
      "workflow.step.delta",
      "workflow.step.tool",
      "workflow.step.succeeded",
      "workflow.run.succeeded",
      "workflow.run.failed",
    ]) {
      source.addEventListener(type, handle as EventListener);
    }
    source.onerror = () => {
      // EventSource auto-reconnects.
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
        filename: u.filename,
        sizeBytes: u.sizeBytes,
      })),
    });
    if (!conversationId) {
      createConversation.mutate({ firstMessage: text });
    } else {
      sendMessage.mutate(text);
    }
    setDraft("");
  };

  if (!workflow.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const sending =
    createConversation.isPending ||
    sendMessage.isPending ||
    uploadingCount > 0 ||
    Boolean(activeRunId);
  const empty = messages.length === 0 && steps.length === 0 && !optimistic && !sending;
  const notPublished = !workflow.data.currentVersionId;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <header className="flex items-center gap-3 border-b pb-3">
        <span className="flex size-9 items-center justify-center rounded-full border border-border bg-primary text-primary-foreground">
          <FlowArrowIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-base font-semibold leading-tight">
            {workflow.data.displayName}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.data?.title ?? `${workflow.data.steps.length}-step pipeline`}
          </p>
        </div>
        {conversationId && messages.length > 0 ? (
          <ReportIssueDialog
            workflowConversationId={conversationId}
            targetLabel="workflow conversation"
          />
        ) : null}
        {conversationId && isOperator ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/workflows/${slug}/chat/${conversationId}/debug`}>
              <TerminalWindowIcon data-icon="inline-start" />
              Debug
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          <Link to={`/workflows/${workflow.data.slug}/conversations`}>
            <ClockCounterClockwiseIcon data-icon="inline-start" />
            History
          </Link>
        </Button>
        {isOperator ? (
          <Button asChild variant="outline" size="sm">
            <Link to={`/workflows/${workflow.data.slug}/edit`}>
              <PencilSimpleIcon data-icon="inline-start" />
              Edit
            </Link>
          </Button>
        ) : null}
      </header>

      {notPublished ? (
        <Alert>
          <WarningCircleIcon />
          <AlertTitle>Publish before running</AlertTitle>
          <AlertDescription>
            This workflow has no published version yet. Publish it from the editor before
            running.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-8 px-1 py-4">
            {empty ? (
              <AiChatEmptyState
                displayName={workflow.data.displayName}
                avatar={null}
                starterPrompts={workflow.data.starterPrompts}
                onPick={setDraft}
              />
            ) : (
              <>
                {messages.map((message) => (
                  <AiChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    attachments={message.attachments}
                    footer={
                      message.role === "assistant" && message.agentRunId ? (
                        <AssistantRunAttachments runId={message.agentRunId} />
                      ) : null
                    }
                  />
                ))}

                {optimistic ? (
                  <AiChatMessage
                    role="user"
                    content={optimistic.text}
                    attachments={optimistic.attachments.map((attachment, index) => ({
                      id: `optimistic-${index}`,
                      filename: attachment.filename,
                      contentType: "application/octet-stream",
                      sizeBytes: attachment.sizeBytes,
                    }))}
                  />
                ) : null}

                {steps.length > 0 ? (
                  <PipelinePanel steps={steps} running={Boolean(activeRunId)} />
                ) : sending ? (
                  <Message from="assistant">
                    <MessageContent>
                      <span className="text-sm text-muted-foreground">
                        Starting workflow…
                      </span>
                    </MessageContent>
                  </Message>
                ) : null}
              </>
            )}
          </ConversationContent>
          <AiConversationDownload
            messages={messages}
            filename={`${slug ?? "workflow"}.md`}
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
            onRemoveUpload={(item) =>
              setPendingUploads((prev) =>
                prev.filter(
                  (pending) => pending.chatAttachmentId !== item.chatAttachmentId,
                ),
              )
            }
            uploadingCount={uploadingCount}
            sending={sending}
            placeholder={`Message ${workflow.data.displayName}…`}
          />
        </div>
      </div>
    </div>
  );
}

function finishLatestToolCall(
  toolCalls: LiveToolCall[],
  toolName: string,
): LiveToolCall[] {
  const idx = toolCalls.findLastIndex(
    (tc) => tc.toolName === toolName && tc.done === false,
  );
  if (idx < 0) return toolCalls;
  const next = [...toolCalls];
  const row = next[idx];
  if (!row) return toolCalls;
  next[idx] = { ...row, done: true };
  return next;
}

function toActivityEvent(event: StreamEvent): WorkflowActivityEvent {
  return {
    key: `${event.type}-${event.seq}`,
    seq: event.seq,
    type: event.type,
    createdAt: event.createdAt,
    payload: event.payload,
    summary: summariseWorkflowEvent(event),
  };
}

function summariseWorkflowEvent(event: StreamEvent): string {
  const p = event.payload;
  if (event.type === "workflow.step.started") {
    return `Started ${stringPayload(p.agentDisplayName) ?? stringPayload(p.agentSlug) ?? "step"}`;
  }
  if (event.type === "workflow.step.tool") {
    const status = p.status === "end" ? "finished" : "started";
    return `${stringPayload(p.toolName) ?? "tool"} ${status}`;
  }
  if (event.type === "workflow.step.succeeded") {
    const output =
      typeof p.output === "string" ? p.output.replace(/\s+/g, " ").trim() : "";
    return output ? `Completed: ${truncate(output, 96)}` : "Completed";
  }
  if (event.type === "workflow.run.failed") {
    return typeof p.error === "string" ? p.error : "Failed";
  }
  return event.type;
}

function stringPayload(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  if (status === "running")
    return <SpinnerGapIcon className="size-4 animate-spin text-primary" />;
  if (status === "succeeded")
    return <CheckCircleIcon className="size-4 text-emerald-600" weight="fill" />;
  if (status === "failed")
    return <XCircleIcon className="size-4 text-destructive" weight="fill" />;
  return <span className="size-2 rounded-full bg-muted-foreground/40" />;
}

function WorkflowActivityCard({ event }: { event: WorkflowActivityEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border bg-muted/30">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <CaretDownIcon className="size-3 text-muted-foreground" />
        ) : (
          <CaretRightIcon className="size-3 text-muted-foreground" />
        )}
        <span className="font-mono text-[10px] text-muted-foreground">#{event.seq}</span>
        <span className="rounded-sm bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {event.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {event.summary}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {new Date(event.createdAt).toLocaleTimeString()}
        </span>
      </button>
      {open ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function PipelinePanel({ steps, running }: { steps: StepState[]; running: boolean }) {
  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        <span className="text-xs font-medium text-muted-foreground">
          {running ? "Running pipeline…" : "Pipeline"}
        </span>
        <div className="flex flex-col gap-1.5">
          {steps.map((step, idx) => (
            <StepCard
              key={step.position}
              index={idx}
              step={step}
              defaultOpen={step.status === "running"}
            />
          ))}
        </div>
      </MessageContent>
    </Message>
  );
}

function StepCard({
  index,
  step,
  defaultOpen,
}: {
  index: number;
  step: StepState;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (step.status === "running") setOpen(true);
  }, [step.status]);

  const hasBody =
    step.text.trim().length > 0 ||
    step.attachments.length > 0 ||
    step.toolCalls.length > 0 ||
    step.events.length > 0;

  return (
    <div className="border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {hasBody ? (
          open ? (
            <CaretDownIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <CaretRightIcon className="size-3.5 text-muted-foreground" />
          )
        ) : (
          <span className="size-3.5" />
        )}
        <StepStatusIcon status={step.status} />
        <span className="text-xs text-muted-foreground">Step {index + 1}</span>
        <span className="truncate text-sm font-medium">{step.agentDisplayName}</span>
      </button>
      {open && hasBody ? (
        <div className="flex flex-col gap-2 border-t px-3 py-2">
          {step.events.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {step.events.map((event) => (
                <WorkflowActivityCard key={event.key} event={event} />
              ))}
            </div>
          ) : null}
          {step.toolCalls.length > 0 ? (
            <div className="flex flex-col gap-2">
              {step.toolCalls.map((tc) => (
                <AiToolCall
                  key={tc.callId}
                  toolName={tc.toolName}
                  output={tc.output}
                  running={!tc.done}
                  args={tc.args}
                />
              ))}
            </div>
          ) : null}
          {step.text.trim().length > 0 ? (
            <MessageResponse isAnimating={step.status === "running"}>
              {step.text}
            </MessageResponse>
          ) : null}
          {step.attachments.length > 0 && step.runId ? (
            <AiRunAttachments
              attachments={step.attachments.map((attachment) => ({
                ...attachment,
                href: runAttachmentDownloadUrl(step.runId!, attachment.id),
              }))}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
