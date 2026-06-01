import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChatCircleDotsIcon,
  DotsThreeIcon,
  EnvelopeIcon,
  GlobeIcon,
  PencilSimpleIcon,
  PlusIcon,
  RobotIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { DeleteAgentDialog } from "@/components/DeleteAgentDialog";
import { ApiError, api } from "@/lib/api";
import { avatarSrc, canOperateAgents, useAgents, useCurrentUser } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export default function AgentsListPage() {
  const agents = useAgents();
  const user = useCurrentUser();
  const canManageAgents = canOperateAgents(user.data?.role);
  const [open, setOpen] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (input: { slug: string; displayName: string; description?: string }) =>
      api<{ slug: string }>("/api/agents", { json: input }),
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Agent created", {
        description: `${created.slug} is ready to configure.`,
      });
      setOpen(false);
      void navigate(`/agents/${created.slug}/edit`);
    },
    onError: (e) => {
      toast.error("Couldn't create agent", {
        description: e instanceof ApiError ? e.message : String(e),
      });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agents"
        description="One row per agent. Save edits as draft; publish freezes the runtime config for new runs."
        actions={
          canManageAgents ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusIcon data-icon="inline-start" />
                  New agent
                </Button>
              </DialogTrigger>
              <CreateAgentDialog
                onCreate={(values) => createMutation.mutate(values)}
                submitting={createMutation.isPending}
              />
            </Dialog>
          ) : null
        }
      />

      {agents.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !agents.data || agents.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RobotIcon />
            </EmptyMedia>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>
              {canManageAgents
                ? "Click 'New agent' to bootstrap your first one."
                : "Ask an admin to grant you access to an agent."}
            </EmptyDescription>
          </EmptyHeader>
          {canManageAgents ? (
            <EmptyContent>
              <Button onClick={() => setOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                New agent
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
                <TableHead>Surfaces</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    <Link
                      to={`/agents/${a.slug}`}
                      className="flex items-center gap-2 underline-offset-4 hover:underline"
                    >
                      <Avatar size="sm">
                        {a.avatar ? (
                          <AvatarImage src={avatarSrc(a.avatar)} alt={a.displayName} />
                        ) : null}
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {a.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {a.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {a.slug}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {a.webEnabled ? (
                        <Badge variant="secondary">
                          <GlobeIcon data-icon="inline-start" />
                          web
                        </Badge>
                      ) : null}
                      {a.emailEnabled ? (
                        <Badge variant="secondary">
                          <EnvelopeIcon data-icon="inline-start" />
                          email
                        </Badge>
                      ) : null}
                      {!a.webEnabled && !a.emailEnabled ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {a.accessMode}
                    </Badge>
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
                          <Link to={`/agents/${a.slug}`}>
                            <RobotIcon data-icon="inline-start" />
                            View details
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to={`/agents/${a.slug}/chat`}>
                            <ChatCircleDotsIcon data-icon="inline-start" />
                            Open chat
                          </Link>
                        </DropdownMenuItem>
                        {canManageAgents ? (
                          <DropdownMenuItem asChild>
                            <Link to={`/agents/${a.slug}/edit`}>
                              <PencilSimpleIcon data-icon="inline-start" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                        ) : null}
                        {canManageAgents ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleteSlug(a.slug)}
                          >
                            <TrashIcon data-icon="inline-start" />
                            Delete agent
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

      {deleteSlug && agents.data ? (
        <DeleteAgentDialog
          slug={deleteSlug}
          displayName={
            agents.data.find((a) => a.slug === deleteSlug)?.displayName ?? deleteSlug
          }
          open
          onOpenChange={(next) => {
            if (!next) setDeleteSlug(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateAgentDialog({
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
        <DialogTitle>New agent</DialogTitle>
        <DialogDescription>
          Bootstrap an empty agent. You&apos;ll configure tools, skills, and the system
          prompt next.
        </DialogDescription>
      </DialogHeader>
      <form
        id="new-agent-form"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            slug,
            displayName,
            description: description.trim() || undefined,
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-name">Display name</FieldLabel>
            <Input
              id="new-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Support bot"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-slug">Slug</FieldLabel>
            <Input
              id="new-slug"
              required
              pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="support-bot"
              className="font-mono"
            />
            <FieldDescription>
              Lowercase letters, digits, dashes. Used as the URL path and inbound email
              local-part.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-desc">
              Description
              <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Textarea
              id="new-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button form="new-agent-form" type="submit" disabled={submitting}>
          {submitting ? <Spinner data-icon="inline-start" /> : null}
          {submitting ? "Creating…" : "Create agent"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
