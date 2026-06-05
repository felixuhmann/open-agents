import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  ChatCircleDotsIcon,
  CheckCircleIcon,
  ClipboardIcon,
  FlowArrowIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import type { IssueDetailRunEvent, WorkflowTrace, WorkflowTraceRun } from "@/lib/queries";
import { filterDebugTraceEvents } from "@/lib/traceEventVisibility";
import { Markdown } from "@/components/Markdown";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function WorkflowTracePanel({ data }: { data: WorkflowTrace }) {
  const pipelineEventCount = data.runs.reduce(
    (acc, run) => acc + filterDebugTraceEvents(run.events).length,
    0,
  );
  const agentEventCount = data.runs.reduce(
    (acc, run) =>
      acc +
      run.stepRuns.reduce(
        (stepAcc, step) =>
          stepAcc +
          (step.agentRun ? filterDebugTraceEvents(step.agentRun.events).length : 0),
        0,
      ),
    0,
  );

  return (
    <>
      <WorkflowContextCard data={data} />
      <Tabs defaultValue="pipeline" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="pipeline">
            <FlowArrowIcon data-icon="inline-start" />
            Pipeline
            <Badge variant="secondary" className="ml-2">
              {pipelineEventCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="steps">
            <TerminalWindowIcon data-icon="inline-start" />
            Step runs
            <Badge variant="secondary" className="ml-2">
              {agentEventCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="conversation">
            <ChatCircleDotsIcon data-icon="inline-start" />
            Conversation
            <Badge variant="secondary" className="ml-2">
              {data.messages.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pipeline" className="m-0">
          <PipelineEvents runs={data.runs} />
        </TabsContent>
        <TabsContent value="steps" className="m-0">
          <StepRuns runs={data.runs} />
        </TabsContent>
        <TabsContent value="conversation" className="m-0">
          <WorkflowConversation data={data} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function WorkflowContextCard({ data }: { data: WorkflowTrace }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlowArrowIcon className="size-5" />
          {data.workflow.displayName}
          <span className="font-mono text-xs text-muted-foreground">
            {data.workflow.slug}
          </span>
        </CardTitle>
        <CardDescription>
          {data.workflow.description ?? "No description configured."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <KeyValue
            label="Published version"
            value={
              data.workflow.currentVersionNumber != null
                ? `v${data.workflow.currentVersionNumber}`
                : null
            }
            mono
          />
          <KeyValue
            label="Web chat"
            value={data.workflow.webEnabled ? "enabled" : "disabled"}
          />
          <KeyValue label="Session user" value={data.session.userEmail} copyable />
          <KeyValue
            label="Conversation"
            value={data.session.conversationId}
            copyable
            mono
          />
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <SectionLabel>
            Backend session ids ({data.session.backendSessionIds.length})
          </SectionLabel>
          {data.session.backendSessionIds.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No backend sessions recorded for this workflow conversation.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.session.backendSessionIds.map((sessionId) => (
                <CopyableMono key={sessionId} value={sessionId} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineEvents({ runs }: { runs: WorkflowTraceRun[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Pipeline events</CardTitle>
        <CardDescription>High-level workflow events streamed to chat.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {runs.flatMap((run) =>
          filterDebugTraceEvents(run.events).map((event) => (
            <TraceEventEntry
              key={`${run.id}-${event.seq}`}
              event={event}
              context={`workflow run ${run.id}`}
            />
          )),
        )}
      </CardContent>
    </Card>
  );
}

function StepRuns({ runs }: { runs: WorkflowTraceRun[] }) {
  return (
    <div className="flex flex-col gap-4">
      {runs.map((run) => (
        <Card key={run.id}>
          <CardHeader>
            <CardTitle className="text-sm">Workflow run {run.id.slice(-8)}</CardTitle>
            <CardDescription>
              {run.status}
              {run.versionNumber != null ? ` · workflow v${run.versionNumber}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {run.stepRuns.map((step) => {
              const agentEvents = step.agentRun
                ? filterDebugTraceEvents(step.agentRun.events)
                : [];
              return (
                <div key={step.id} className="flex flex-col gap-2 border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Step {step.position + 1}</Badge>
                    <span className="font-medium">{step.agentDisplayName}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {step.agentSlug}
                    </span>
                    <Badge
                      variant={step.status === "failed" ? "destructive" : "secondary"}
                    >
                      {step.status}
                    </Badge>
                  </div>
                  {step.inputText ? (
                    <CollapsibleText label="Input" value={step.inputText} />
                  ) : null}
                  {agentEvents.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {agentEvents.map((event) => (
                        <TraceEventEntry
                          key={`${step.runId}-${event.seq}`}
                          event={event}
                          context={`agent run ${step.runId ?? ""}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No agent run events recorded for this step.
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function WorkflowConversation({ data }: { data: WorkflowTrace }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{data.session.label}</CardTitle>
        <CardDescription>Persisted workflow chat messages.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.messages.map((message) => (
          <div key={message.id} className="flex flex-col gap-1 border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{message.role}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(message.createdAt).toLocaleString()}
              </span>
              {message.workflowRunId ? (
                <span className="font-mono text-xs text-muted-foreground">
                  run {message.workflowRunId.slice(-8)}
                </span>
              ) : null}
            </div>
            <div className="text-sm">
              <Markdown>{message.content}</Markdown>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TraceEventEntry({
  event,
  context,
}: {
  event: IssueDetailRunEvent;
  context: string;
}) {
  const summary = summariseEvent(event);
  return (
    <Accordion type="multiple" className="border bg-card px-3">
      <AccordionItem value={`${context}-${event.seq}`} className="border-b-0">
        <AccordionTrigger className="py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              #{event.seq}
            </span>
            <Badge variant={badgeVariantForEvent(event.type)}>{event.type}</Badge>
            {summary ? (
              <span className="truncate text-xs text-muted-foreground">{summary}</span>
            ) : null}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {new Date(event.createdAt).toLocaleTimeString()}
            </span>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="flex items-center justify-between gap-2 pb-1.5 text-[10px] text-muted-foreground">
            <span className="truncate">{context}</span>
            <CopyButton label="Copy event" value={JSON.stringify(event, null, 2)} />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function CollapsibleText({ label, value }: { label: string; value: string }) {
  return (
    <Accordion type="multiple" className="border bg-background px-3">
      <AccordionItem value={label} className="border-b-0">
        <AccordionTrigger className="py-2 text-xs">{label}</AccordionTrigger>
        <AccordionContent>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {value}
          </pre>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function badgeVariantForEvent(
  type: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (type.endsWith(".failed") || type === "run.failed") return "destructive";
  if (type.includes(".tool") || type.startsWith("tool.")) return "outline";
  return "secondary";
}

function summariseEvent(event: IssueDetailRunEvent): string {
  const payload = event.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.toolName === "string") return payload.toolName;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.agentDisplayName === "string") return payload.agentDisplayName;
  if (typeof payload.text === "string") return summariseText(payload.text);
  if (typeof payload.output === "string") return summariseText(payload.output);
  if (typeof payload.sessionId === "string") return `session ${payload.sessionId}`;
  return "";
}

function summariseText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

function KeyValue({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {value ? (
        <span className={mono ? "truncate font-mono" : "truncate"}>
          {value}
          {copyable ? <InlineCopy value={value} /> : null}
        </span>
      ) : (
        <span className="text-muted-foreground italic">none</span>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

function CopyableMono({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1 border bg-muted/40 px-2 py-1 font-mono text-xs">
      <span className="max-w-[22rem] truncate">{value}</span>
      <InlineCopy value={value} />
    </span>
  );
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
      className="ml-1 size-5 shrink-0"
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
