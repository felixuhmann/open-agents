import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileArrowUpIcon,
  PencilSimpleIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  CreateMcpServerInput,
  McpConnectorManifest,
  type McpProbeResult,
  UpdateMcpServerInput,
} from "@open-agents/types";
import { ApiError, api } from "@/lib/api";
import { type McpServerDto, useCurrentUser, useMcpServers } from "@/lib/queries";
import { McpProbeResultPanel, McpProbeStatusBadge } from "@/components/McpProbePanel";
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

function buildCreatePayload(values: McpFormState) {
  return {
    name: values.name,
    label: values.label.trim(),
    description: values.description.trim() || null,
    serverUrl: values.serverUrl.trim(),
    ...(values.bearer.trim() ? { bearer: values.bearer.trim() } : {}),
  };
}

function buildUpdatePayload(values: McpFormState) {
  return {
    name: values.name,
    label: values.label.trim(),
    description: values.description.trim() || null,
    serverUrl: values.serverUrl.trim(),
    ...(values.bearer !== "" ? { bearer: values.bearer } : {}),
  };
}

function McpServerForm({
  title,
  description,
  initial,
  submitLabel,
  pending,
  serverId,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  initial: McpFormState;
  submitLabel: string;
  pending: boolean;
  serverId?: string;
  onSubmit: (values: McpFormState) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [manifestText, setManifestText] = useState("");
  const [probeResult, setProbeResult] = useState<McpProbeResult | null>(null);

  const probe = useMutation({
    mutationFn: async () => {
      const url = values.serverUrl.trim();
      if (!url) throw new ApiError(400, "Enter a server URL first.");
      if (serverId) {
        return api<McpProbeResult>(`/api/mcp-servers/${serverId}/probe`, {
          method: "POST",
          json: values.bearer.trim() ? { bearer: values.bearer.trim() } : {},
        });
      }
      return api<McpProbeResult>("/api/mcp-servers/probe", {
        method: "POST",
        json: {
          serverUrl: url,
          ...(values.bearer.trim() ? { bearer: values.bearer.trim() } : {}),
        },
      });
    },
    onSuccess: (result) => {
      setProbeResult(result);
      if (result.ok) {
        toast.success("Connection successful", { description: result.message });
      } else {
        toast.error("Connection failed", { description: result.message });
      }
    },
    onError: (e) =>
      toast.error("Probe failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const importManifest = () => {
    try {
      const parsed = JSON.parse(manifestText) as unknown;
      const result = McpConnectorManifest.safeParse(parsed);
      if (!result.success) {
        toast.error("Invalid manifest", {
          description: result.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      const m = result.data;
      setValues((v) => ({
        ...v,
        name: m.name,
        label: m.label,
        description: m.description ?? "",
        serverUrl: m.serverUrl,
      }));
      setManifestText("");
      toast.success("Manifest imported", {
        description: "Review the fields and add a bearer token if required.",
      });
    } catch {
      toast.error("Invalid JSON", { description: "Paste a valid connector manifest." });
    }
  };

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
            <FieldLabel htmlFor="mcp-manifest">Import from manifest</FieldLabel>
            <Textarea
              id="mcp-manifest"
              rows={3}
              className="font-mono text-xs"
              placeholder='{"manifestVersion":1,"name":"acme-crm","label":"Acme CRM","serverUrl":"https://…"}'
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
            />
            <FieldDescription>
              Paste JSON from a deployment-specific MCP connector repo. Bearer tokens are
              not included in manifests — enter them below.
            </FieldDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={!manifestText.trim()}
              onClick={importManifest}
            >
              <FileArrowUpIcon data-icon="inline-start" />
              Import manifest
            </Button>
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
            <Input
              id="mcp-name"
              required
              className="font-mono"
              placeholder="notion-prod"
              value={values.name}
              onChange={(e) =>
                setValues((v) => ({ ...v, name: e.target.value.toLowerCase() }))
              }
            />
            <FieldDescription>
              Stable slug (lowercase letters, digits, dashes, underscores). Cannot start
              or end with - or _.
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
          <div className="flex flex-col gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={probe.isPending || !values.serverUrl.trim()}
                onClick={() => probe.mutate()}
              >
                {probe.isPending ? <Spinner data-icon="inline-start" /> : null}
                <PlugsConnectedIcon data-icon="inline-start" />
                Test connection
              </Button>
              {probeResult ? <McpProbeStatusBadge result={probeResult} /> : null}
            </div>
            {probeResult ? (
              <McpProbeResultPanel
                result={probeResult}
                onRetest={() => probe.mutate()}
                retestPending={probe.isPending}
              />
            ) : null}
          </div>
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

function McpServerCard({
  server,
  probeResult,
  probePending,
  isAdmin,
  onEdit,
  onDelete,
  onProbe,
  deletePending,
}: {
  server: McpServerDto;
  probeResult?: McpProbeResult | null;
  probePending?: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onProbe: () => void;
  deletePending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugsConnectedIcon className="size-4" weight="duotone" />
          {server.label}
        </CardTitle>
        <CardDescription className="font-mono">{server.name}</CardDescription>
        <CardAction className="flex gap-1">
          {isAdmin ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={`Test ${server.label}`}
              disabled={probePending}
              onClick={onProbe}
            >
              {probePending ? <Spinner /> : <PlugsConnectedIcon />}
            </Button>
          ) : null}
          {isAdmin ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={`Edit ${server.label}`}
                onClick={onEdit}
              >
                <PencilSimpleIcon />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="destructive"
                aria-label={`Delete ${server.label}`}
                disabled={server.agentCount > 0 || deletePending}
                onClick={onDelete}
              >
                <TrashIcon />
              </Button>
            </>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {server.description ? (
          <p className="text-xs/relaxed text-foreground">{server.description}</p>
        ) : null}
        <p className="truncate font-mono text-xs text-muted-foreground">
          {server.serverUrl}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {isAdmin ? (
            <McpProbeStatusBadge result={probeResult} pending={probePending} />
          ) : null}
          {server.hasBearer ? <Badge variant="secondary">bearer configured</Badge> : null}
          <Badge variant="outline">
            {server.agentCount} agent{server.agentCount === 1 ? "" : "s"}
          </Badge>
        </div>
        {probeResult && isAdmin ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto justify-start px-0 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "Show"} probe details
              {probeResult.toolCount !== undefined
                ? ` · ${probeResult.toolCount} tools`
                : ""}
            </Button>
            {expanded ? (
              <McpProbeResultPanel
                result={probeResult}
                onRetest={onProbe}
                retestPending={probePending}
              />
            ) : null}
          </div>
        ) : null}
        {server.agentCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Detach from all agents before deleting.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function McpLibraryPage() {
  const servers = useMcpServers();
  const user = useCurrentUser();
  const isAdmin = user.data?.role === "admin";
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerDto | null>(null);
  const [autoProbe, setAutoProbe] = useState(false);

  const probeQueries = useQueries({
    queries: (servers.data ?? []).map((server) => ({
      queryKey: ["mcp-servers", server.id, "probe"] as const,
      queryFn: () =>
        api<McpProbeResult>(`/api/mcp-servers/${server.id}/probe`, {
          method: "POST",
          json: {},
        }),
      enabled: Boolean(isAdmin && autoProbe && servers.data?.length),
      staleTime: 120_000,
      retry: false,
    })),
  });

  useEffect(() => {
    if (isAdmin && servers.data?.length) {
      setAutoProbe(true);
    }
  }, [isAdmin, servers.data?.length]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["mcp-servers"] });
  };

  const probeServer = useMutation({
    mutationFn: (id: string) =>
      api<McpProbeResult>(`/api/mcp-servers/${id}/probe`, { method: "POST", json: {} }),
    onSuccess: (result, id) => {
      qc.setQueryData(["mcp-servers", id, "probe"], result);
      if (result.ok) {
        toast.success("Connection successful", { description: result.message });
      } else {
        toast.error("Connection failed", { description: result.message });
      }
    },
    onError: (e) =>
      toast.error("Probe failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const probeAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          const result = await api<McpProbeResult>(`/api/mcp-servers/${id}/probe`, {
            method: "POST",
            json: {},
          });
          return { id, result };
        }),
      );
      return results;
    },
    onSuccess: (results) => {
      for (const { id, result } of results) {
        qc.setQueryData(["mcp-servers", id, "probe"], result);
      }
      const failed = results.filter((r) => !r.result.ok).length;
      if (failed === 0) {
        toast.success("All servers connected");
      } else {
        toast.warning(`${failed} of ${results.length} server(s) failed the health check`);
      }
    },
    onError: (e) =>
      toast.error("Health check failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const create = useMutation({
    mutationFn: (values: McpFormState) => {
      const payload = buildCreatePayload(values);
      const parsed = CreateMcpServerInput.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
      }
      return api<McpServerDto>("/api/mcp-servers", {
        method: "POST",
        json: parsed.data,
      });
    },
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
    mutationFn: ({ id, values }: { id: string; values: McpFormState }) => {
      const payload = buildUpdatePayload(values);
      const parsed = UpdateMcpServerInput.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
      }
      return api<McpServerDto>(`/api/mcp-servers/${id}`, {
        method: "PATCH",
        json: parsed.data,
      });
    },
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

  const probeByServerId = new Map(
    (servers.data ?? []).map((server, index) => [
      server.id,
      {
        result:
          probeQueries[index]?.data ??
          qc.getQueryData<McpProbeResult>(["mcp-servers", server.id, "probe"]),
        pending:
          probeQueries[index]?.isFetching ||
          (probeServer.isPending && probeServer.variables === server.id),
      },
    ]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="MCP servers"
        description="Register third-party Model Context Protocol servers once, then attach them to any agent."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/settings/mcp-connection">
                <PlugsConnectedIcon data-icon="inline-start" />
                Connect external agents
              </Link>
            </Button>
            {isAdmin && servers.data?.length ? (
              <Button
                type="button"
                variant="outline"
                disabled={probeAll.isPending}
                onClick={() => {
                  const ids = servers.data?.map((s) => s.id) ?? [];
                  if (ids.length) probeAll.mutate(ids);
                }}
              >
                {probeAll.isPending ? <Spinner data-icon="inline-start" /> : null}
                Check all
              </Button>
            ) : null}
            {isAdmin ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                Add server
              </Button>
            ) : null}
          </div>
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
          {servers.data.map((server) => {
            const probe = probeByServerId.get(server.id);
            return (
              <li key={server.id}>
                <McpServerCard
                  server={server}
                  isAdmin={Boolean(isAdmin)}
                  probeResult={probe?.result}
                  probePending={probe?.pending}
                  onEdit={() => setEditing(server)}
                  onDelete={() => remove.mutate(server.id)}
                  onProbe={() => probeServer.mutate(server.id)}
                  deletePending={remove.isPending}
                />
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Attach servers on an agent&apos;s{" "}
        <Link to="/agents" className="text-primary underline-offset-4 hover:underline">
          edit page
        </Link>
        . With Daytona, the orchestrator connects to external MCP servers on each run.
        {isAdmin
          ? " Use Test connection to verify URL and bearer credentials, preview discovered tools, and surface auth failures before attaching a server to agents."
          : null}
      </p>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {editing ? (
            <McpServerForm
              key={editing.id}
              title="Edit MCP server"
              description="Updating URL or label affects every agent that uses this server after the next publish."
              initial={formFromServer(editing)}
              submitLabel="Save"
              pending={update.isPending}
              serverId={editing.id}
              onCancel={() => setEditing(null)}
              onSubmit={(values) => update.mutate({ id: editing.id, values })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
