import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  PencilSimpleIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { type McpServerDto, useMcpServers } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type McpFormState = {
  name: string;
  label: string;
  description: string;
  serverUrl: string;
  bearer: string;
};

const emptyForm = (): McpFormState => ({
  name: "",
  label: "",
  description: "",
  serverUrl: "",
  bearer: "",
});

function McpServerForm({
  title,
  description,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  initial: McpFormState;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: McpFormState) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(values);
        }}
      >
        <FieldGroup className="py-2">
          <Field>
            <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
            <Input
              id="mcp-name"
              required
              className="font-mono"
              placeholder="notion-prod"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
            <FieldDescription>
              Stable slug (lowercase letters, digits, dashes, underscores).
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-label">Label</FieldLabel>
            <Input
              id="mcp-label"
              required
              value={values.label}
              onChange={(e) => setValues((v) => ({ ...v, label: e.target.value }))}
            />
            <FieldDescription>
              Shown in the agent editor and sent to the runtime.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-url">Server URL</FieldLabel>
            <Input
              id="mcp-url"
              required
              type="url"
              className="font-mono"
              placeholder="https://…"
              value={values.serverUrl}
              onChange={(e) => setValues((v) => ({ ...v, serverUrl: e.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-desc">Description</FieldLabel>
            <Textarea
              id="mcp-desc"
              rows={2}
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-bearer">Bearer token</FieldLabel>
            <Input
              id="mcp-bearer"
              type="password"
              autoComplete="off"
              placeholder="Optional"
              value={values.bearer}
              onChange={(e) => setValues((v) => ({ ...v, bearer: e.target.value }))}
            />
            <FieldDescription>
              Leave blank when editing to keep the stored token. Enter an empty value to
              clear.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function formFromServer(server: McpServerDto): McpFormState {
  return {
    name: server.name,
    label: server.label,
    description: server.description ?? "",
    serverUrl: server.serverUrl,
    bearer: "",
  };
}

export default function McpLibraryPage() {
  const servers = useMcpServers();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerDto | null>(null);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["mcp-servers"] });
  };

  const create = useMutation({
    mutationFn: (values: McpFormState) =>
      api<McpServerDto>("/api/mcp-servers", {
        method: "POST",
        json: {
          name: values.name.trim(),
          label: values.label.trim(),
          description: values.description.trim() || null,
          serverUrl: values.serverUrl.trim(),
          ...(values.bearer.trim() ? { bearer: values.bearer.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      toast.success("MCP server created");
      setCreateOpen(false);
      await invalidate();
    },
    onError: (e) =>
      toast.error("Couldn't create server", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: McpFormState }) =>
      api<McpServerDto>(`/api/mcp-servers/${id}`, {
        method: "PATCH",
        json: {
          name: values.name.trim(),
          label: values.label.trim(),
          description: values.description.trim() || null,
          serverUrl: values.serverUrl.trim(),
          ...(values.bearer !== "" ? { bearer: values.bearer } : {}),
        },
      }),
    onSuccess: async () => {
      toast.success("MCP server updated");
      setEditing(null);
      await invalidate();
    },
    onError: (e) =>
      toast.error("Couldn't update server", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/mcp-servers/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("MCP server removed");
      await invalidate();
    },
    onError: (e) =>
      toast.error("Couldn't delete", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="MCP servers"
        description="Register third-party Model Context Protocol servers once, then attach them to any agent."
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add server
          </Button>
        }
      />

      {servers.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-40" />
          ))}
        </div>
      ) : !servers.data?.length ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugsConnectedIcon />
            </EmptyMedia>
            <EmptyTitle>No MCP servers yet</EmptyTitle>
            <EmptyDescription>
              Add a server to connect external tools (Notion, custom HTTP MCP, and
              similar) to your agents.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {servers.data.map((server) => (
            <li key={server.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PlugsConnectedIcon className="size-4" weight="duotone" />
                    {server.label}
                  </CardTitle>
                  <CardDescription className="font-mono">{server.name}</CardDescription>
                  <CardAction className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label={`Edit ${server.label}`}
                      onClick={() => setEditing(server)}
                    >
                      <PencilSimpleIcon />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      aria-label={`Delete ${server.label}`}
                      disabled={server.agentCount > 0 || remove.isPending}
                      onClick={() => remove.mutate(server.id)}
                    >
                      <TrashIcon />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {server.description ? (
                    <p className="text-xs/relaxed text-foreground">
                      {server.description}
                    </p>
                  ) : null}
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {server.serverUrl}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {server.hasBearer ? (
                      <Badge variant="secondary">bearer configured</Badge>
                    ) : null}
                    <Badge variant="outline">
                      {server.agentCount} agent{server.agentCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {server.agentCount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Detach from all agents before deleting.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Attach servers on an agent&apos;s{" "}
        <Link to="/agents" className="text-primary underline-offset-4 hover:underline">
          edit page
        </Link>
        . With Daytona, the orchestrator connects to external MCP servers on each run.
      </p>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <McpServerForm
            title="Add MCP server"
            description="Credentials are encrypted at rest. Bearer tokens are never returned to the browser."
            initial={emptyForm()}
            submitLabel="Create"
            pending={create.isPending}
            onCancel={() => setCreateOpen(false)}
            onSubmit={(values) => create.mutate(values)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing ? (
            <McpServerForm
              key={editing.id}
              title="Edit MCP server"
              description="Updating URL or label affects every agent that uses this server after the next publish."
              initial={formFromServer(editing)}
              submitLabel="Save"
              pending={update.isPending}
              onCancel={() => setEditing(null)}
              onSubmit={(values) => update.mutate({ id: editing.id, values })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
