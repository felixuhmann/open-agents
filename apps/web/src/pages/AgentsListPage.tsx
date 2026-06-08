import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MagnifyingGlassIcon, PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { AgentListRow } from "@/components/AgentListRow";
import { DeleteAgentDialog } from "@/components/DeleteAgentDialog";
import { ApiError, api } from "@/lib/api";
import { canOperateAgents, useAgents, useCurrentUser } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const ALL_CATEGORIES = "__all__";

type CreateAgentFormInput = {
  slug: string;
  displayName: string;
  description?: string;
  category?: string;
};

export default function AgentsListPage() {
  const agents = useAgents();
  const user = useCurrentUser();
  const canManageAgents = canOperateAgents(user.data?.role);
  const [open, setOpen] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (input: CreateAgentFormInput) =>
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

  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const agent of agents.data ?? []) {
      const category = agent.category?.trim();
      if (category) unique.add(category);
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [agents.data]);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return (agents.data ?? []).filter((agent) => {
      const category = agent.category?.trim() ?? "";
      if (categoryFilter !== ALL_CATEGORIES && category !== categoryFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [agent.displayName, agent.slug, agent.description ?? "", category]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [agents.data, categoryFilter, searchQuery]);

  const filtersActive =
    searchQuery.trim().length > 0 || categoryFilter !== ALL_CATEGORIES;

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
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search agents"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, slug, description, or category…"
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {filtersActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter(ALL_CATEGORIES);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>

          {filteredAgents.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MagnifyingGlassIcon />
                </EmptyMedia>
                <EmptyTitle>No matching agents</EmptyTitle>
                <EmptyDescription>
                  Try a different search term or category filter.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter(ALL_CATEGORIES);
                  }}
                >
                  Clear filters
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="overflow-hidden border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Surfaces</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead className="w-[1%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgents.map((a) => (
                    <AgentListRow
                      key={a.id}
                      agent={a}
                      canManageAgents={canManageAgents}
                      onDelete={() => setDeleteSlug(a.slug)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
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
  onCreate: (input: CreateAgentFormInput) => void;
  submitting: boolean;
}) {
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");

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
            category: category.trim() || undefined,
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
            <FieldLabel htmlFor="new-category">
              Category
              <span className="text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="new-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Support"
            />
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
