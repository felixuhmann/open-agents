import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChatCircleDotsIcon,
  DotsThreeIcon,
  FlowArrowIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { canOperateAgents, useCurrentUser, useWorkflows } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export default function WorkflowsListPage() {
  const workflows = useWorkflows();
  const user = useCurrentUser();
  const canManage = canOperateAgents(user.data?.role);
  const [open, setOpen] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (input: { slug: string; displayName: string; description?: string }) =>
      api<{ slug: string }>("/api/workflows", { json: input }),
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Workflow created", {
        description: `${created.slug} is ready to configure.`,
      });
      setOpen(false);
      void navigate(`/workflows/${created.slug}/edit`);
    },
    onError: (e) => {
      toast.error("Couldn't create workflow", {
        description: e instanceof ApiError ? e.message : String(e),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) =>
      api(`/api/workflows/${slug}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Workflow deleted");
      setDeleteSlug(null);
    },
    onError: (e) =>
      toast.error("Couldn't delete workflow", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workflows"
        description="Chain published agents into a pipeline. Each step's text + file outputs feed the next; the last step's answer is delivered to the user."
        actions={
          canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusIcon data-icon="inline-start" />
                  New workflow
                </Button>
              </DialogTrigger>
              <CreateWorkflowDialog
                onCreate={(values) => createMutation.mutate(values)}
                submitting={createMutation.isPending}
              />
            </Dialog>
          ) : null
        }
      />

      {workflows.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !workflows.data || workflows.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlowArrowIcon />
            </EmptyMedia>
            <EmptyTitle>No workflows yet</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Click 'New workflow' to chain a few agents together."
                : "Ask an admin to grant you access to a workflow."}
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button onClick={() => setOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                New workflow
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-hidden border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.data.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">
                    <Link
                      to={
                        w.published
                          ? `/workflows/${w.slug}/chat`
                          : canManage
                            ? `/workflows/${w.slug}/edit`
                            : `/workflows/${w.slug}/chat`
                      }
                      className="flex items-center gap-2 underline-offset-4 hover:underline"
                    >
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                        <FlowArrowIcon className="size-3.5" />
                      </span>
                      {w.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {w.slug}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{w.stepCount}</Badge>
                  </TableCell>
                  <TableCell>
                    {w.published ? (
                      <Badge variant="outline">published</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        draft
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Open actions">
                          <DotsThreeIcon weight="bold" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/workflows/${w.slug}/chat`}>
                            <ChatCircleDotsIcon data-icon="inline-start" />
                            Open chat
                          </Link>
                        </DropdownMenuItem>
                        {canManage ? (
                          <DropdownMenuItem asChild>
                            <Link to={`/workflows/${w.slug}/edit`}>
                              <PencilSimpleIcon data-icon="inline-start" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                        ) : null}
                        {canManage ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleteSlug(w.slug)}
                          >
                            <TrashIcon data-icon="inline-start" />
                            Delete workflow
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={Boolean(deleteSlug)}
        onOpenChange={(next) => {
          if (!next) setDeleteSlug(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the workflow and all of its conversations. Member agents are
              not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteSlug) deleteMutation.mutate(deleteSlug);
              }}
            >
              {deleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateWorkflowDialog({
  onCreate,
  submitting,
}: {
  onCreate: (input: { slug: string; displayName: string; description?: string }) => void;
  submitting: boolean;
}) {
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>New workflow</DialogTitle>
        <DialogDescription>
          Bootstrap an empty pipeline. You&apos;ll add the agent steps next.
        </DialogDescription>
      </DialogHeader>
      <form
        id="new-workflow-form"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({ slug, displayName, description: description.trim() || undefined });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="wf-name">Display name</FieldLabel>
            <Input
              id="wf-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Research → Draft → Edit"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wf-slug">Slug</FieldLabel>
            <Input
              id="wf-slug"
              required
              pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="research-pipeline"
              className="font-mono"
            />
            <FieldDescription>
              Lowercase letters, digits, dashes. Used as the URL path.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="wf-desc">
              Description
              <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Textarea
              id="wf-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button form="new-workflow-form" type="submit" disabled={submitting}>
          {submitting ? <Spinner data-icon="inline-start" /> : null}
          {submitting ? "Creating…" : "Create workflow"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
