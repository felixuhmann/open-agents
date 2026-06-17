import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarCheckIcon,
  ChatCircleDotsIcon,
  FlowArrowIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RobotIcon,
  TerminalWindowIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  useAgents,
  useScheduledTaskRuns,
  useScheduledTasks,
  useWorkflows,
  type ScheduledTask,
} from "@/lib/queries";

const DEFAULT_CRON = "0 9 * * *";

export default function ScheduledTasksPage() {
  const tasks = useScheduledTasks();
  const agents = useAgents();
  const workflows = useWorkflows();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => tasks.data?.find((task) => task.id === selectedId) ?? tasks.data?.[0] ?? null,
    [selectedId, tasks.data],
  );

  const createTask = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<ScheduledTask>("/api/scheduled-tasks", { json: body }),
    onSuccess: (task) => {
      toast.success("Scheduled task created");
      setSelectedId(task.id);
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
    },
    onError: (err) => toast.error("Could not create task", { description: String(err) }),
  });

  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<ScheduledTask>(`/api/scheduled-tasks/${id}`, { method: "PATCH", json: body }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] }),
  });

  const runTask = useMutation({
    mutationFn: (id: string) =>
      api<{ runId: string }>(`/api/scheduled-tasks/${id}/run`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Scheduled task queued");
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
    },
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true }>(`/api/scheduled-tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelectedId(null);
      toast.success("Scheduled task deleted");
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
    },
  });

  if (tasks.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <CalendarCheckIcon className="size-6" />
            Scheduled tasks
          </span>
        }
        description="Run an agent or workflow automatically on a cron interval with a saved prompt and full session history."
      />

      <NewTaskCard
        agents={agents.data ?? []}
        workflows={workflows.data ?? []}
        isPending={createTask.isPending}
        onCreate={(body) => createTask.mutate(body)}
      />

      {!tasks.data || tasks.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No scheduled tasks yet</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            Create one to call an agent or workflow on a cron schedule.
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-3">
            {tasks.data.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                selected={task.id === selected?.id}
                onSelect={() => setSelectedId(task.id)}
                onToggle={() =>
                  updateTask.mutate({
                    id: task.id,
                    body: { status: task.status === "active" ? "paused" : "active" },
                  })
                }
                onRun={() => runTask.mutate(task.id)}
                onDelete={() => deleteTask.mutate(task.id)}
              />
            ))}
          </div>
          {selected ? <TaskHistory task={selected} /> : null}
        </div>
      )}
    </div>
  );
}

type TargetOption = { slug: string; displayName: string };

function NewTaskCard({
  agents,
  workflows,
  isPending,
  onCreate,
}: {
  agents: TargetOption[];
  workflows: TargetOption[];
  isPending: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [targetType, setTargetType] = useState<"agent" | "workflow">("agent");
  const [targetSlug, setTargetSlug] = useState("");
  const options = targetType === "agent" ? agents : workflows;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusIcon />
          New scheduled task
        </CardTitle>
        <CardDescription>
          Use standard five-field cron syntax, for example <code>{DEFAULT_CRON}</code> for
          09:00 UTC daily.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onCreate({
              name: form.get("name"),
              targetType,
              agentSlug: targetType === "agent" ? targetSlug : undefined,
              workflowSlug: targetType === "workflow" ? targetSlug : undefined,
              cron: form.get("cron"),
              prompt: form.get("prompt"),
              timezone: "UTC",
            });
            event.currentTarget.reset();
            setTargetSlug("");
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-name">Name</FieldLabel>
              <Input
                id="task-name"
                name="name"
                required
                placeholder="Daily customer digest"
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field>
                <FieldLabel>Target type</FieldLabel>
                <Select
                  value={targetType}
                  onValueChange={(value) => {
                    setTargetType(value as "agent" | "workflow");
                    setTargetSlug("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="workflow">Workflow</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Target</FieldLabel>
                <Select value={targetSlug} onValueChange={setTargetSlug} required>
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${targetType}`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {options.map((option) => (
                        <SelectItem key={option.slug} value={option.slug}>
                          {option.displayName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-cron">Cron</FieldLabel>
                <Input id="task-cron" name="cron" required defaultValue={DEFAULT_CRON} />
                <FieldDescription>Evaluated in UTC.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="task-prompt">Prompt</FieldLabel>
              <Textarea
                id="task-prompt"
                name="prompt"
                required
                rows={5}
                placeholder="What should the agent or workflow do every time this schedule fires?"
              />
            </Field>
          </FieldGroup>
          <Button
            type="submit"
            disabled={isPending || !targetSlug}
            className="self-start"
          >
            <PlusIcon data-icon="inline-start" />
            Create schedule
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TaskCard({
  task,
  selected,
  onSelect,
  onToggle,
  onRun,
  onDelete,
}: {
  task: ScheduledTask;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const target =
    task.targetType === "agent" ? task.agent?.displayName : task.workflow?.displayName;
  return (
    <Card className={selected ? "border-primary" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <button type="button" className="text-left" onClick={onSelect}>
            {task.name}
          </button>
          <Badge variant={task.status === "active" ? "default" : "secondary"}>
            {task.status}
          </Badge>
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          {task.targetType === "agent" ? <RobotIcon /> : <FlowArrowIcon />}
          {target} · <span className="font-mono">{task.cron}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="line-clamp-3 text-sm text-muted-foreground">{task.prompt}</p>
        <div className="text-xs text-muted-foreground">
          Next run:{" "}
          {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "paused"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onRun}>
            <PlayIcon data-icon="inline-start" />
            Run now
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onToggle}>
            {task.status === "active" ? (
              <PauseIcon data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {task.status === "active" ? "Pause" : "Resume"}
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
            <TrashIcon data-icon="inline-start" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskHistory({ task }: { task: ScheduledTask }) {
  const runs = useScheduledTaskRuns(task.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          Every scheduled invocation creates a normal chat session with the same debug
          view.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {runs.isLoading ? <Skeleton className="h-32 w-full" /> : null}
        {runs.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : null}
        {runs.data?.map((run) => {
          const chatHref =
            run.conversationId && task.agent
              ? `/agents/${task.agent.slug}/chat/${run.conversationId}`
              : run.workflowConversationId && task.workflow
                ? `/workflows/${task.workflow.slug}/chat/${run.workflowConversationId}`
                : null;
          const debugHref =
            run.conversationId && task.agent
              ? `/agents/${task.agent.slug}/chat/${run.conversationId}/debug`
              : run.workflowConversationId && task.workflow
                ? `/workflows/${task.workflow.slug}/chat/${run.workflowConversationId}/debug`
                : null;
          return (
            <div key={run.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{run.status}</Badge>
                  <span className="text-sm">
                    {new Date(run.scheduledFor).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  {chatHref ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to={chatHref}>
                        <ChatCircleDotsIcon data-icon="inline-start" />
                        Chat
                      </Link>
                    </Button>
                  ) : null}
                  {debugHref ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to={debugHref}>
                        <TerminalWindowIcon data-icon="inline-start" />
                        Debug
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
              {run.error ? (
                <p className="mt-2 text-sm text-destructive">{run.error}</p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
