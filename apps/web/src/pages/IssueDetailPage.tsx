import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
  ClipboardIcon,
  EnvelopeSimpleIcon,
  GearIcon,
  PuzzlePieceIcon,
  RobotIcon,
  TerminalWindowIcon,
  UserIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  avatarSrc,
  canOperateAgents,
  useCurrentUser,
  useIssue,
  type IssueDetail,
  type IssueDetailAgent,
  type IssueDetailMessage,
  type IssueDetailRun,
  type IssueDetailRunEvent,
} from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Markdown } from "@/components/Markdown";
import { StatusBadge, SurfaceBadge } from "./IssuesListPage";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export default function IssueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useCurrentUser();
  const issue = useIssue(id);
  const qc = useQueryClient();

  const setStatus = useMutation({
    mutationFn: (next: "open" | "resolved") =>
      api<IssueDetail>(`/api/issues/${id}`, {
        method: "PATCH",
        json: { status: next },
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(["issues", id], updated);
      await qc.invalidateQueries({ queryKey: ["issues"] });
      toast.success(
        updated.status === "resolved" ? "Issue marked resolved" : "Issue reopened",
      );
    },
    onError: (e) =>
      toast.error("Couldn't update issue", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  if (me.data && !canOperateAgents(me.data.role)) {
    return <Navigate to="/" replace />;
  }

  if (issue.isLoading || !issue.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const data = issue.data;
  const totalEvents = data.runs.reduce((acc, r) => acc + r.events.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/issues">
            <ArrowLeftIcon data-icon="inline-start" />
            All issues
          </Link>
        </Button>
        <PageHeader
          title={`Issue against ${data.agent.displayName}`}
          description={`Filed ${new Date(data.createdAt).toLocaleString()} by ${data.reporterEmail}.`}
          actions={
            <div className="flex items-center gap-2">
              <StatusBadge status={data.status} />
              <SurfaceBadge surface={data.surface} />
              <CopyButton
                label="Copy everything"
                value={JSON.stringify(buildFullExport(data), null, 2)}
              />
              {data.status === "open" ? (
                <Button
                  size="sm"
                  onClick={() => setStatus.mutate("resolved")}
                  disabled={setStatus.isPending}
                >
                  {setStatus.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CheckCircleIcon data-icon="inline-start" />
                  )}
                  Mark resolved
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setStatus.mutate("open")}
                  disabled={setStatus.isPending}
                >
                  {setStatus.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <WarningCircleIcon data-icon="inline-start" />
                  )}
                  Reopen
                </Button>
              )}
            </div>
          }
        />
      </div>

      <ReportSummaryCard data={data} />

      <AgentContextCard agent={data.agent} session={data.session} runs={data.runs} />

      <Tabs defaultValue="trace" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="trace">
            <TerminalWindowIcon data-icon="inline-start" />
            Unified trace
            <Badge variant="secondary" className="ml-2">
              {data.messages.length + totalEvents}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="conversation">
            {data.surface === "chat" ? (
              <ChatCircleDotsIcon data-icon="inline-start" />
            ) : (
              <EnvelopeSimpleIcon data-icon="inline-start" />
            )}
            Conversation
            <Badge variant="secondary" className="ml-2">
              {data.messages.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trace" className="m-0">
          <UnifiedTraceView data={data} />
        </TabsContent>
        <TabsContent value="conversation" className="m-0">
          <ConversationView data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReportSummaryCard({ data }: { data: IssueDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">What went wrong</CardTitle>
        <CardDescription>
          Reporter: <span className="font-medium">{data.reporterEmail}</span>
          {data.reporterName ? <span> ({data.reporterName})</span> : null}
          {data.resolvedAt ? (
            <span>
              {" · "}Resolved {new Date(data.resolvedAt).toLocaleString()}
              {data.resolvedByEmail ? ` by ${data.resolvedByEmail}` : ""}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm">{data.description}</p>
        {data.session.conversationId ? (
          <p className="mt-3 text-xs text-muted-foreground">
            <Link
              className="underline hover:text-foreground"
              to={`/agents/${data.agent.slug}/chat/${data.session.conversationId}`}
            >
              Open the live conversation →
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AgentContextCard({
  agent,
  session,
  runs,
}: {
  agent: IssueDetailAgent;
  session: IssueDetail["session"];
  runs: IssueDetailRun[];
}) {
  const initials = agent.displayName.slice(0, 2).toUpperCase();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Avatar className="size-7">
            {agent.avatar ? (
              <AvatarImage src={avatarSrc(agent.avatar)} alt={agent.displayName} />
            ) : null}
            <AvatarFallback className="bg-muted text-foreground text-[10px]">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span>{agent.displayName}</span>
          <span className="text-xs text-muted-foreground font-mono">{agent.slug}</span>
        </CardTitle>
        <CardDescription>
          {agent.description ?? "No description configured."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <KeyValue label="Model" value={agent.model} mono />
          <KeyValue
            label="Anthropic agent id"
            value={agent.anthropicAgentId}
            mono
            copyable
          />
          <KeyValue label="Environment id" value={agent.environmentId} mono copyable />
          <KeyValue label="Published version" value={agent.anthropicAgentVersion} mono />
          <KeyValue label="Web chat" value={agent.webEnabled ? "enabled" : "disabled"} />
          <KeyValue
            label="Email"
            value={
              agent.emailEnabled ? `enabled (${agent.inboundLocalPart}@…)` : "disabled"
            }
          />
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <SectionLabel>
            Anthropic session ids ({session.anthropicSessionIds.length})
          </SectionLabel>
          {session.anthropicSessionIds.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No sessions recorded for this conversation.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {session.anthropicSessionIds.map((sid) => (
                <CopyableMono key={sid} value={sid} />
              ))}
            </div>
          )}
          {runs.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              Sessions rotate when new attachments are added (resources only mount at
              session-creation).
            </p>
          ) : null}
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <SectionLabel>
            <WrenchIcon className="mr-1 inline size-3 align-text-bottom" />
            Tools ({agent.tools.length})
          </SectionLabel>
          {agent.tools.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No tools bound.</p>
          ) : (
            <ToolGroup label="Capabilities" tools={agent.tools} />
          )}
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <SectionLabel>
            <PuzzlePieceIcon className="mr-1 inline size-3 align-text-bottom" />
            Skills ({agent.skills.length})
          </SectionLabel>
          {agent.skills.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No skills attached.</p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {agent.skills.map((s) => (
                <li
                  key={s.bindingId}
                  className="flex flex-col gap-0.5 border bg-card px-2 py-1 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {s.name}
                      <span className="ml-1 font-normal text-muted-foreground">
                        v{s.versionNumber}
                      </span>
                    </span>
                    {s.anthropicSkillId ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {s.anthropicSkillId}
                        {s.anthropicSkillVersion ? `@${s.anthropicSkillVersion}` : ""}
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        local only
                      </Badge>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {s.skillVersionId}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <SectionLabel>
            Third-party MCP servers ({agent.thirdPartyMcp.length})
          </SectionLabel>
          {agent.thirdPartyMcp.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">None configured.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {agent.thirdPartyMcp.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-2 border bg-card px-2 py-1 text-xs"
                >
                  <Badge variant="outline">{m.label}</Badge>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {m.serverUrl}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        <CollapsibleBlock
          title="System prompt"
          subtitle={`${agent.systemPrompt.length.toLocaleString()} chars`}
          actions={
            agent.systemPrompt ? (
              <CopyButton label="Copy" value={agent.systemPrompt} />
            ) : null
          }
        >
          {agent.systemPrompt ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
              {agent.systemPrompt}
            </pre>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground italic">
              No system prompt configured.
            </p>
          )}
        </CollapsibleBlock>

        <CollapsibleBlock
          title="Last published payload"
          subtitle={
            agent.publishedAt
              ? `published ${new Date(agent.publishedAt).toLocaleString()}`
              : "never published"
          }
          actions={
            agent.publishedPayload ? (
              <CopyButton
                label="Copy"
                value={JSON.stringify(agent.publishedPayload, null, 2)}
              />
            ) : null
          }
          icon={<GearIcon className="size-3" />}
        >
          {agent.publishedPayload ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(agent.publishedPayload, null, 2)}
            </pre>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground italic">
              The agent has not been published to Anthropic yet.
            </p>
          )}
        </CollapsibleBlock>
      </CardContent>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function ToolGroup({
  label,
  tools,
}: {
  label: string;
  tools: IssueDetail["agent"]["tools"];
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <Badge key={t.bindingId} variant={t.deprecated ? "outline" : "secondary"}>
            <WrenchIcon data-icon="inline-start" />
            {t.name}
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              {t.key}
            </span>
            {t.deprecated ? (
              <span className="ml-1 text-[10px] text-destructive">deprecated</span>
            ) : null}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function KeyValue({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  copyable?: boolean;
}) {
  const display = value ?? "—";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "min-w-0 truncate",
            mono ? "font-mono text-[12px]" : "text-sm",
            value ? "text-foreground" : "text-muted-foreground italic",
          )}
          title={value ?? undefined}
        >
          {display}
        </span>
        {copyable && value ? <InlineCopy value={value} /> : null}
      </div>
    </div>
  );
}

function CopyableMono({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1 border bg-card px-1.5 py-0.5 font-mono text-[11px]">
      <span className="truncate" title={value}>
        {value}
      </span>
      <InlineCopy value={value} />
    </span>
  );
}

function CollapsibleBlock({
  title,
  subtitle,
  actions,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-muted/50"
        aria-expanded={open}
      >
        {icon}
        <span>{title}</span>
        {subtitle ? <span className="text-muted-foreground">· {subtitle}</span> : null}
        <span className="ml-auto text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="border-t">
          {actions ? (
            <div className="flex items-center justify-end px-3 py-2">{actions}</div>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ConversationView({ data }: { data: IssueDetail }) {
  if (data.messages.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No messages persisted on this session.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-4 p-4">
            {data.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                agentDisplayName={data.agent.displayName}
                agentAvatar={data.agent.avatar}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function MessageBubble({
  message,
  agentDisplayName,
  agentAvatar,
}: {
  message: IssueDetailMessage;
  agentDisplayName: string;
  agentAvatar: string | null;
}) {
  if (message.kind === "chat") {
    const mine = message.role === "user";
    const isSystem = message.role === "system";
    return (
      <div
        className={cn(
          "flex w-full items-start gap-3",
          mine ? "flex-row-reverse" : "flex-row",
        )}
      >
        <Avatar className="size-7 shrink-0">
          {!mine && !isSystem && agentAvatar ? (
            <AvatarImage src={avatarSrc(agentAvatar)} alt={agentDisplayName} />
          ) : null}
          <AvatarFallback
            className={cn(
              "text-[10px]",
              mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            )}
          >
            {mine ? (
              <UserIcon className="size-3.5" />
            ) : (
              <RobotIcon className="size-3.5" />
            )}
          </AvatarFallback>
        </Avatar>
        <div
          className={cn(
            "flex max-w-[80%] flex-col gap-1",
            mine ? "items-end" : "items-start",
          )}
        >
          <div
            className={cn(
              "px-3 py-2 text-sm leading-relaxed",
              mine || isSystem ? "whitespace-pre-wrap" : null,
              mine
                ? "bg-primary text-primary-foreground"
                : isSystem
                  ? "bg-muted/50 text-muted-foreground italic"
                  : "bg-muted text-foreground",
            )}
          >
            {mine || isSystem ? message.content : <Markdown>{message.content}</Markdown>}
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(message.createdAt).toLocaleString()}
          </span>
        </div>
      </div>
    );
  }
  const inbound = message.direction === "inbound";
  return (
    <div
      className={cn(
        "flex w-full items-start gap-3",
        inbound ? "flex-row" : "flex-row-reverse",
      )}
    >
      <Avatar className="size-7 shrink-0">
        {!inbound && agentAvatar ? (
          <AvatarImage src={avatarSrc(agentAvatar)} alt={agentDisplayName} />
        ) : null}
        <AvatarFallback className="bg-muted text-foreground text-[10px]">
          {inbound ? (
            <UserIcon className="size-3.5" />
          ) : (
            <RobotIcon className="size-3.5" />
          )}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-1",
          inbound ? "items-start" : "items-end",
        )}
      >
        <Badge variant="outline" className="text-xs">
          {message.subject}
        </Badge>
        <div
          className={cn(
            "whitespace-pre-wrap px-3 py-2 text-sm leading-relaxed",
            inbound ? "bg-muted text-foreground" : "bg-primary/10 text-foreground",
          )}
        >
          {message.body}
        </div>
        <span className="text-xs text-muted-foreground">
          {message.direction} · {new Date(message.createdAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/**
 * Unified timeline merging user messages, inbound/outbound emails, and the
 * raw run-event log. Items are ordered by timestamp; assistant chat
 * messages are skipped because their text already appears as
 * `agent.message` events in the run stream.
 */
type UnifiedItem =
  | {
      kind: "user-chat";
      ts: string;
      message: IssueDetailMessage & { kind: "chat" };
    }
  | {
      kind: "system-chat";
      ts: string;
      message: IssueDetailMessage & { kind: "chat" };
    }
  | {
      kind: "inbound-email";
      ts: string;
      message: IssueDetailMessage & { kind: "email" };
    }
  | {
      kind: "outbound-email";
      ts: string;
      message: IssueDetailMessage & { kind: "email" };
    }
  | {
      kind: "event";
      ts: string;
      runId: string;
      runStatus: string;
      runStartedAt: string;
      sessionId: string | null;
      event: IssueDetailRunEvent;
    };

function buildUnifiedTimeline(data: IssueDetail): UnifiedItem[] {
  const out: UnifiedItem[] = [];
  for (const m of data.messages) {
    if (m.kind === "chat") {
      // Assistant chat messages duplicate the run's `agent.message`
      // event text; skip them so the timeline doesn't repeat itself.
      if (m.role === "user") {
        out.push({ kind: "user-chat", ts: m.createdAt, message: m });
      } else if (m.role === "system") {
        out.push({ kind: "system-chat", ts: m.createdAt, message: m });
      }
    } else {
      out.push({
        kind: m.direction === "inbound" ? "inbound-email" : "outbound-email",
        ts: m.createdAt,
        message: m,
      });
    }
  }
  for (const r of data.runs) {
    for (const ev of r.events) {
      out.push({
        kind: "event",
        ts: ev.createdAt,
        runId: r.id,
        runStatus: r.status,
        runStartedAt: r.startedAt,
        sessionId: r.sessionId,
        event: ev,
      });
    }
  }
  out.sort((a, b) => {
    const at = new Date(a.ts).getTime();
    const bt = new Date(b.ts).getTime();
    if (at !== bt) return at - bt;
    // Stable secondary order: events keep their per-run seq so
    // identical-timestamp events stay in producer order.
    if (a.kind === "event" && b.kind === "event") {
      if (a.runId !== b.runId) return a.runId.localeCompare(b.runId);
      return a.event.seq - b.event.seq;
    }
    return 0;
  });
  return out;
}

function buildFullExport(data: IssueDetail): unknown {
  return {
    issue: {
      id: data.id,
      surface: data.surface,
      status: data.status,
      description: data.description,
      reporter: {
        email: data.reporterEmail,
        userId: data.reporterUserId,
        name: data.reporterName,
      },
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      resolvedAt: data.resolvedAt,
    },
    agent: data.agent,
    session: data.session,
    timeline: buildUnifiedTimeline(data),
    runs: data.runs,
    messages: data.messages,
  };
}

function UnifiedTraceView({ data }: { data: IssueDetail }) {
  const timeline = useMemo(() => buildUnifiedTimeline(data), [data]);

  if (timeline.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing recorded for this session yet.
        </CardContent>
      </Card>
    );
  }

  const userMessageCount = timeline.filter(
    (i) => i.kind === "user-chat" || i.kind === "inbound-email",
  ).length;
  const eventCount = timeline.filter((i) => i.kind === "event").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Unified trace</CardTitle>
        <CardDescription>
          Every user message and every event the run-agent worker streamed from the
          Anthropic Sessions API, ordered chronologically. Includes assistant text, tool
          calls and results, thinking, run start/end, and errors.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            label="Copy unified trace (JSON)"
            value={JSON.stringify(timeline, null, 2)}
          />
          <CopyButton
            label="Copy events only"
            value={JSON.stringify(
              data.runs.map((r) => ({
                runId: r.id,
                sessionId: r.sessionId,
                status: r.status,
                error: r.error,
                startedAt: r.startedAt,
                completedAt: r.completedAt,
                skillsAvailable: r.skillsAvailable,
                events: r.events,
              })),
              null,
              2,
            )}
          />
          <span className="text-xs text-muted-foreground">
            {userMessageCount} user message{userMessageCount === 1 ? "" : "s"} ·{" "}
            {eventCount} run event{eventCount === 1 ? "" : "s"} · {data.runs.length} run
            {data.runs.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-col">
          {timeline.map((item, idx) => (
            <TimelineEntry key={timelineKey(item, idx)} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function timelineKey(item: UnifiedItem, idx: number): string {
  if (item.kind === "event") return `ev:${item.runId}:${item.event.seq}`;
  return `${item.kind}:${item.message.id}:${idx}`;
}

function TimelineEntry({ item }: { item: UnifiedItem }) {
  if (item.kind === "event") {
    return <EventEntry item={item} />;
  }
  return <MessageEntry item={item} />;
}

function MessageEntry({ item }: { item: Exclude<UnifiedItem, { kind: "event" }> }) {
  const meta = describeMessageEntry(item);
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 border-l-2 border-primary/40 py-2 pl-3">
      <div className="flex flex-col items-end pr-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          {new Date(item.ts).toLocaleTimeString()}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="default">
            <UserIcon data-icon="inline-start" />
            {meta.label}
          </Badge>
          {meta.subBadge ? (
            <Badge variant="outline" className="text-[10px]">
              {meta.subBadge}
            </Badge>
          ) : null}
          <span className="text-[10px] text-muted-foreground">
            {new Date(item.ts).toLocaleString()}
          </span>
        </div>
        <div className="whitespace-pre-wrap break-words bg-muted/40 px-3 py-2 text-xs">
          {meta.body}
        </div>
      </div>
    </div>
  );
}

function describeMessageEntry(item: Exclude<UnifiedItem, { kind: "event" }>): {
  label: string;
  subBadge?: string;
  body: string;
} {
  switch (item.kind) {
    case "user-chat":
      return { label: "user", body: item.message.content };
    case "system-chat":
      return { label: "system", body: item.message.content };
    case "inbound-email":
      return {
        label: "user (email)",
        subBadge: item.message.subject,
        body: item.message.body,
      };
    case "outbound-email":
      return {
        label: "agent email sent",
        subBadge: item.message.subject,
        body: item.message.body,
      };
  }
}

function EventEntry({ item }: { item: Extract<UnifiedItem, { kind: "event" }> }) {
  const ev = item.event;
  const summary = summariseEvent(ev);
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 border-l-2 border-muted-foreground/30 py-1 pl-3">
      <div className="flex flex-col items-end pr-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          {new Date(item.ts).toLocaleTimeString()}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">#{ev.seq}</span>
      </div>
      <Accordion type="multiple" className="min-w-0">
        <AccordionItem value={`${item.runId}-${ev.seq}`} className="border-b-0">
          <AccordionTrigger className="py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
              <Badge variant={badgeVariantForEvent(ev.type)}>{ev.type}</Badge>
              {summary ? (
                <span className="truncate text-xs text-muted-foreground">{summary}</span>
              ) : null}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                run {item.runId.slice(-6)}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex items-center justify-between gap-2 pb-1.5 text-[10px] text-muted-foreground">
              <span className="truncate">
                run {item.runId} · status {item.runStatus}
                {item.sessionId ? ` · session ${item.sessionId}` : ""}
              </span>
              <CopyButton label="Copy event" value={JSON.stringify(ev, null, 2)} />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(ev.payload, null, 2)}
            </pre>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function badgeVariantForEvent(
  type: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (type === "run.failed" || type === "session.error") return "destructive";
  if (type.startsWith("tool.")) return "outline";
  return "secondary";
}

function summariseEvent(ev: IssueDetailRunEvent): string {
  const p = ev.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return "";
  if (ev.type === "skills.materialized" && Array.isArray(p.skills)) {
    const count = p.skills.length;
    const ok = (p.skills as Array<{ status?: string }>).filter(
      (s) => s.status === "materialized",
    ).length;
    return `${ok}/${count} skills materialized`;
  }
  if (typeof p.toolName === "string") return p.toolName;
  if (typeof p.text === "string") {
    const flat = p.text.replace(/\s+/g, " ").trim();
    return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
  }
  if (typeof p.output === "string") {
    const flat = p.output.replace(/\s+/g, " ").trim();
    return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
  }
  if (typeof p.error === "string") return p.error;
  if (typeof p.message === "string") return p.message;
  if (typeof p.sessionId === "string") return `session ${p.sessionId}`;
  return "";
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error("Couldn't copy", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick}>
      {copied ? (
        <CheckCircleIcon data-icon="inline-start" />
      ) : (
        <ClipboardIcon data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
}

function InlineCopy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="size-5 shrink-0"
      aria-label="Copy"
      onClick={onClick}
    >
      {copied ? (
        <CheckCircleIcon className="size-3" />
      ) : (
        <ClipboardIcon className="size-3" />
      )}
    </Button>
  );
}
