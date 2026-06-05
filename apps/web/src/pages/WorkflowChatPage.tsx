import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  FileIcon,
  FlowArrowIcon,
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
import { Markdown } from "@/components/Markdown";
import { Composer } from "@/components/chat/Composer";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ReportIssueDialog } from "@/components/chat/ReportIssueDialog";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { AssistantRunAttachments } from "@/components/chat/AssistantRunAttachments";
import { formatBytes } from "@/components/chat/utils";
import { cn } from "@/lib/utils";

type StreamEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type StepStatus = "pending" | "running" | "succeeded" | "failed";

type LiveToolCall = { callId: string; toolName: string; output: string; done: boolean };

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
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const isOperator = canOperateAgents(me.data?.role);

  const messages = useMemo(() => conversation.data?.messages ?? [], [conversation.data]);

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

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom("smooth");
  }, [messages, steps, optimistic]);

  useEffect(() => {
    if (!optimistic) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser && lastUser.content === optimistic) setOptimistic(null);
  }, [messages, optimistic]);

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
    const text = draft.trim();
    if (!text || !slug) return;
    setOptimistic(text);
    atBottomRef.current = true;
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
    createConversation.isPending || sendMessage.isPending || Boolean(activeRunId);
  const initials = workflow.data.displayName.slice(0, 2).toUpperCase();
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
          <Link to={`/workflows/${workflow.data.slug}/edit`}>
            <ClockCounterClockwiseIcon data-icon="inline-start" />
            Edit
          </Link>
        </Button>
      </header>

      {notPublished ? (
        <div className="flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <WarningCircleIcon className="size-4 shrink-0" />
          This workflow has no published version yet. Publish it from the editor before
          running.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
            {empty ? (
              <ChatEmptyState
                agentDisplayName={workflow.data.displayName}
                agentAvatar={null}
                agentInitials={initials}
                starterPrompts={workflow.data.starterPrompts}
                onPick={(text) => setDraft(text)}
              />
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-1 py-4">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <UserBubble key={m.id} content={m.content} />
                  ) : (
                    <AssistantBubble
                      key={m.id}
                      content={m.content}
                      agentRunId={m.agentRunId}
                    />
                  ),
                )}

                {optimistic ? <UserBubble content={optimistic} /> : null}

                {steps.length > 0 ? (
                  <PipelinePanel steps={steps} running={Boolean(activeRunId)} />
                ) : sending ? (
                  <TypingIndicator />
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
            onFiles={() => undefined}
            pendingUploads={[]}
            onRemoveUpload={() => undefined}
            uploadingCount={0}
            sending={sending}
            placeholder={`Message ${workflow.data.displayName}…`}
          />
        </div>
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex w-full justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap bg-primary px-3 py-2 text-sm text-primary-foreground">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  agentRunId,
}: {
  content: string;
  agentRunId: string | null;
}) {
  return (
    <div className="flex w-full items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-foreground">
        <FlowArrowIcon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 overflow-hidden text-sm">
        <Markdown>{content}</Markdown>
        {agentRunId ? <AssistantRunAttachments runId={agentRunId} /> : null}
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
    <div className="flex w-full items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-foreground">
        <FlowArrowIcon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
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
      </div>
    </div>
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
                <ToolCallCard
                  key={tc.callId}
                  toolName={tc.toolName}
                  output={tc.output}
                  running={!tc.done}
                />
              ))}
            </div>
          ) : null}
          {step.text.trim().length > 0 ? (
            <div
              className={cn(
                "overflow-hidden text-sm",
                step.status === "running" && "streaming-markdown",
              )}
            >
              <Markdown>{step.text}</Markdown>
            </div>
          ) : null}
          {step.attachments.length > 0 && step.runId ? (
            <div className="flex flex-wrap gap-1.5">
              {step.attachments.map((a) => (
                <a
                  key={a.id}
                  href={runAttachmentDownloadUrl(step.runId!, a.id)}
                  download={a.filename}
                  className="inline-flex items-center gap-1.5 border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                >
                  <FileIcon className="size-3.5" />
                  <span className="max-w-[18rem] truncate" title={a.filename}>
                    {a.filename}
                  </span>
                  <span className="text-muted-foreground">
                    {formatBytes(a.sizeBytes)}
                  </span>
                  <DownloadSimpleIcon className="size-3.5" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
