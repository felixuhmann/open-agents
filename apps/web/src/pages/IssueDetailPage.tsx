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
  RobotIcon,
  UserIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  avatarSrc,
  useCurrentUser,
  useIssue,
  type IssueDetail,
  type IssueDetailMessage,
  type IssueDetailRun,
  type IssueDetailRunEvent,
} from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Markdown } from "@/components/Markdown";
import { StatusBadge, SurfaceBadge } from "./IssuesListPage";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
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

  if (me.data && me.data.role !== "admin") {
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

      <SummaryCard data={data} />

      <Tabs defaultValue="conversation" className="flex flex-col gap-4">
        <TabsList>
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
          <TabsTrigger value="trace">
            Raw trace
            <Badge variant="secondary" className="ml-2">
              {data.runs.reduce((acc, r) => acc + r.events.length, 0)}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conversation" className="m-0">
          <ConversationView data={data} />
        </TabsContent>
        <TabsContent value="trace" className="m-0">
          <TraceView data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ data }: { data: IssueDetail }) {
  const initials = data.agent.displayName.slice(0, 2).toUpperCase();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Avatar className="size-7 rounded-none">
            {data.agent.avatar ? (
              <AvatarImage
                className="rounded-none"
                src={avatarSrc(data.agent.avatar)}
                alt={data.agent.displayName}
              />
            ) : null}
            <AvatarFallback className="rounded-none bg-muted text-foreground text-[10px]">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span>{data.agent.displayName}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground truncate">
            {data.session.label ||
              (data.surface === "chat" ? "Conversation" : "Email thread")}
          </span>
        </CardTitle>
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
        <p className="text-xs/relaxed font-medium uppercase tracking-wider text-muted-foreground">
          What went wrong
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm">{data.description}</p>
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
        <Avatar className="size-7 shrink-0 rounded-none">
          {!mine && !isSystem && agentAvatar ? (
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
      <Avatar className="size-7 shrink-0 rounded-none">
        {!inbound && agentAvatar ? (
          <AvatarImage
            className="rounded-none"
            src={avatarSrc(agentAvatar)}
            alt={agentDisplayName}
          />
        ) : null}
        <AvatarFallback className="rounded-none bg-muted text-foreground text-[10px]">
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

function TraceView({ data }: { data: IssueDetail }) {
  const fullTrace = useMemo(
    () =>
      data.runs.map((r) => ({
        runId: r.id,
        status: r.status,
        error: r.error,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        events: r.events,
      })),
    [data.runs],
  );

  if (data.runs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No runs were recorded for this session.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Run trace</CardTitle>
        <CardDescription>
          Every event the run-agent worker streamed from the Anthropic Sessions API.
          Includes assistant text, tool calls and results, thinking, and errors.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            label="Copy full trace (JSON)"
            value={JSON.stringify(fullTrace, null, 2)}
          />
          <span className="text-xs text-muted-foreground">
            {data.runs.length} run{data.runs.length === 1 ? "" : "s"} ·{" "}
            {data.runs.reduce((acc, r) => acc + r.events.length, 0)} events
          </span>
        </div>
        {data.runs.map((r) => (
          <RunTrace key={r.id} run={r} />
        ))}
      </CardContent>
    </Card>
  );
}

function RunTrace({ run }: { run: IssueDetailRun }) {
  const isFailed = run.status === "failed";
  return (
    <div className="border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Badge variant={isFailed ? "destructive" : "secondary"}>{run.status}</Badge>
        <span className="font-mono text-xs">{run.id}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(run.startedAt).toLocaleString()}
          {run.completedAt
            ? ` → ${new Date(run.completedAt).toLocaleTimeString()}`
            : null}
        </span>
        <div className="ml-auto">
          <CopyButton
            label="Copy this run"
            value={JSON.stringify(
              {
                runId: run.id,
                status: run.status,
                error: run.error,
                startedAt: run.startedAt,
                completedAt: run.completedAt,
                events: run.events,
              },
              null,
              2,
            )}
          />
        </div>
      </div>
      {run.error ? (
        <div className="border-b bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {run.error}
        </div>
      ) : null}
      {run.events.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">No events recorded.</p>
      ) : (
        <Accordion type="multiple" className="px-3">
          {run.events.map((ev) => (
            <AccordionItem key={ev.seq} value={`${run.id}-${ev.seq}`}>
              <AccordionTrigger>
                <div className="flex min-w-0 items-center gap-2 pr-2">
                  <span className="w-10 font-mono text-xs text-muted-foreground">
                    #{ev.seq}
                  </span>
                  <Badge variant={badgeVariantForEvent(ev.type)}>{ev.type}</Badge>
                  <span className="truncate text-xs text-muted-foreground">
                    {summariseEvent(ev)}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex items-center justify-end pb-1.5">
                  <CopyButton label="Copy event" value={JSON.stringify(ev, null, 2)} />
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}

function badgeVariantForEvent(
  type: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (type === "run.failed") return "destructive";
  if (type.startsWith("tool.")) return "outline";
  return "secondary";
}

function summariseEvent(ev: IssueDetailRunEvent): string {
  const p = ev.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return "";
  if (typeof p.toolName === "string") return p.toolName;
  if (typeof p.text === "string") {
    const flat = p.text.replace(/\s+/g, " ").trim();
    return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
  }
  if (typeof p.error === "string") return p.error;
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
