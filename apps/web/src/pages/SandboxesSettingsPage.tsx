import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArchiveIcon,
  ArrowsClockwiseIcon,
  CloudIcon,
  CubeIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import {
  providerCapabilities,
  useSandboxOrphans,
  useSandboxProviderStatus,
  useSandboxes,
  useSelectSandboxProvider,
  type SandboxProviderCapabilities,
  type SandboxProviderId,
  type SandboxSummary,
} from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

function stateVariant(
  state: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (state === "started") return "default";
  if (state === "error") return "destructive";
  if (state === "stopped" || state === "archived") return "secondary";
  return "outline";
}

const PROVIDER_LABELS: Record<string, string> = {
  daytona: "Daytona",
  broker: "Self-hosted broker",
};

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * Deployment-wide provider selection.
 *
 * Switching is deliberately blunt: it only changes where the *next* sandbox is
 * created. Existing rows keep dispatching through the provider that made them,
 * so history stays manageable — but their workspaces do not follow.
 */
function ProviderCard() {
  const status = useSandboxProviderStatus();
  const select = useSelectSandboxProvider();
  const [pending, setPending] = useState<SandboxProviderId | null>(null);

  const choose = (provider: SandboxProviderId) => {
    setPending(null);
    select.mutate(provider, {
      onSuccess: () =>
        toast.success(`New sandboxes now run on ${providerLabel(provider)}`, {
          description: "Existing sessions keep their current sandbox until replaced.",
        }),
      onError: (e) =>
        toast.error("Could not switch provider", {
          description: e instanceof ApiError ? e.message : String(e),
        }),
    });
  };

  if (status.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!status.data) return null;

  const { active, providers, warnings } = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CubeIcon />
          Sandbox provider
        </CardTitle>
        <CardDescription>
          One provider is active for the whole deployment. Every existing sandbox is still
          managed through the provider that created it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {warnings.map((warning) => (
          <Alert key={warning} variant="destructive">
            <WarningIcon />
            <AlertTitle>Active provider is unusable</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ))}

        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => {
            const isActive = provider.id === active;
            return (
              <div
                key={provider.id}
                className={`rounded-md border p-3 ${
                  isActive ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{providerLabel(provider.id)}</span>
                  {isActive ? <Badge>Active</Badge> : null}
                </div>

                <div className="mt-1 flex items-center gap-1.5 text-sm">
                  <Badge variant={provider.available ? "default" : "secondary"}>
                    {provider.available ? "Reachable" : "Unavailable"}
                  </Badge>
                </div>
                {provider.detail ? (
                  <p className="mt-1 text-xs text-muted-foreground">{provider.detail}</p>
                ) : null}

                {provider.capabilities ? (
                  <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    <div>
                      <dt className="inline font-medium">Egress modes: </dt>
                      <dd className="inline">
                        {provider.capabilities.networkModes.join(", ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Archive: </dt>
                      <dd className="inline">
                        {provider.capabilities.archive ? "supported" : "not supported"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Recover: </dt>
                      <dd className="inline">
                        {provider.capabilities.recover ? "supported" : "not supported"}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                {!isActive ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={!provider.available || select.isPending}
                    onClick={() => setPending(provider.id)}
                  >
                    {select.isPending ? <Spinner className="size-3" /> : null}
                    Make active
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {pending ? providerLabel(pending) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  New sandboxes will be created on {pending ? providerLabel(pending) : ""}
                  . This is a blunt switch, not a migration:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    The next use of an existing session gets a <strong>new, empty</strong>{" "}
                    workspace. Files in the old sandbox are not migrated.
                  </li>
                  <li>
                    Chat history and model context are kept — they live in this
                    deployment&apos;s database, not in the sandbox.
                  </li>
                  <li>
                    Runs already in flight may finish on the old provider. Switching is
                    not guaranteed to take effect for an active session.
                  </li>
                  <li>
                    Agents with a CIDR egress allow list cannot run on the broker; clear
                    the allow list first or leave those agents on Daytona.
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && choose(pending)}>
              Switch provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SandboxActions({
  sandbox,
  capabilities,
}: {
  sandbox: SandboxSummary;
  /** Of the row's *own* provider — not the active one. */
  capabilities: SandboxProviderCapabilities | null;
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["sandboxes"] });

  const onActionError = (e: unknown) =>
    toast.error("Action failed", {
      description: e instanceof ApiError ? e.message : String(e),
    });

  const sync = useMutation({
    mutationFn: () => api(`/api/sandboxes/${sandbox.id}/sync`, { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sandbox updated");
    },
    onError: onActionError,
  });
  const stop = useMutation({
    mutationFn: () => api(`/api/sandboxes/${sandbox.id}/stop`, { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sandbox updated");
    },
    onError: onActionError,
  });
  const start = useMutation({
    mutationFn: () => api(`/api/sandboxes/${sandbox.id}/start`, { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sandbox updated");
    },
    onError: onActionError,
  });
  const archive = useMutation({
    mutationFn: () => api(`/api/sandboxes/${sandbox.id}/archive`, { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sandbox updated");
    },
    onError: onActionError,
  });
  const recover = useMutation({
    mutationFn: () => api(`/api/sandboxes/${sandbox.id}/recover`, { method: "POST" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sandbox updated");
    },
    onError: onActionError,
  });
  const del = useMutation({
    mutationFn: () => api(`/api/sandboxes/${sandbox.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sandbox deleted");
    },
    onError: onActionError,
  });

  const busy =
    sync.isPending ||
    stop.isPending ||
    start.isPending ||
    archive.isPending ||
    recover.isPending ||
    del.isPending;

  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => sync.mutate()}>
        {sync.isPending ? <Spinner className="size-3" /> : <ArrowsClockwiseIcon />}
        Sync
      </Button>
      {sandbox.state === "started" ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => stop.mutate()}>
          <StopIcon data-icon="inline-start" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => start.mutate()}
        >
          <PlayIcon data-icon="inline-start" />
          Start
        </Button>
      )}
      {/*
        Capabilities unknown (provider unreachable) means we cannot claim the
        action is unsupported, so it stays enabled and fails loudly instead.
      */}
      {capabilities?.archive !== false ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => archive.mutate()}
        >
          <ArchiveIcon data-icon="inline-start" />
          Archive
        </Button>
      ) : null}
      {sandbox.state === "error" &&
      sandbox.recoverable &&
      capabilities?.recover !== false ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => recover.mutate()}
        >
          <WrenchIcon data-icon="inline-start" />
          Recover
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={() => del.mutate()}
      >
        <TrashIcon data-icon="inline-start" />
        Delete
      </Button>
    </div>
  );
}

export default function SandboxesSettingsPage() {
  const [stateFilter, setStateFilter] = useState<string>("");
  const sandboxes = useSandboxes(stateFilter || undefined);
  const orphans = useSandboxOrphans();
  const providerStatus = useSandboxProviderStatus();
  const qc = useQueryClient();

  const reconcile = useMutation({
    mutationFn: () => api("/api/sandboxes/reconcile", { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sandboxes"] });
      toast.success("Reconciliation finished");
    },
    onError: (e) =>
      toast.error("Reconcile failed", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const items = sandboxes.data?.sandboxes ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sandboxes"
        description="Workspaces backing chat and email sessions, across every provider this deployment has used. Stale sandboxes are stopped automatically; use reconcile to sync provider state."
        actions={
          <Button
            variant="outline"
            disabled={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            {reconcile.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <ArrowsClockwiseIcon data-icon="inline-start" />
            )}
            Reconcile now
          </Button>
        }
      />

      <ProviderCard />

      {orphans.data?.orphans && orphans.data.orphans.length > 0 ? (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">Unregistered sandboxes</CardTitle>
            <CardDescription>
              These sandboxes still exist on their provider but have no database row.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground">
              {orphans.data.orphans.map((o) => (
                <li key={`${o.provider}:${o.providerSandboxId}`}>
                  <Badge variant="outline" className="mr-1.5">
                    {providerLabel(o.provider)}
                  </Badge>
                  <code className="text-xs">{o.providerSandboxId}</code> — {o.state}
                  {o.agentId ? ` (agent ${o.agentId})` : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudIcon />
            Tracked sandboxes
          </CardTitle>
          <CardDescription>
            Filter by state or run reconcile to stop long-idle VMs and clear orphaned
            session pointers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {["", "started", "stopped", "archived", "error"].map((s) => (
              <Button
                key={s || "all"}
                size="sm"
                variant={stateFilter === s ? "default" : "outline"}
                onClick={() => setStateFilter(s)}
              >
                {s || "All"}
              </Button>
            ))}
          </div>

          {sandboxes.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sandboxes match this filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Surface</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((sb) => (
                  <TableRow key={sb.id}>
                    <TableCell>
                      <Badge variant={stateVariant(sb.state)}>{sb.state}</Badge>
                      {sb.errorReason ? (
                        <p className="mt-1 max-w-xs truncate text-xs text-destructive">
                          {sb.errorReason}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {/* The row's own provider, not the active one — a row
                          created before a switch is still managed there. */}
                      <Badge variant="outline">{providerLabel(sb.provider)}</Badge>
                    </TableCell>
                    <TableCell>
                      {sb.agentSlug ? (
                        <Link
                          to={`/agents/${sb.agentSlug}`}
                          className="font-medium hover:underline"
                        >
                          {sb.agentDisplayName ?? sb.agentSlug}
                        </Link>
                      ) : (
                        sb.agentId
                      )}
                      <p className="font-mono text-xs text-muted-foreground">
                        {sb.providerSandboxId}
                      </p>
                    </TableCell>
                    <TableCell>
                      {sb.surface === "chat" && sb.conversationId ? (
                        <Link
                          to={`/agents/${sb.agentSlug}/chat/${sb.conversationId}`}
                          className="text-sm hover:underline"
                        >
                          {sb.conversationTitle ?? "Chat"}
                        </Link>
                      ) : sb.surface === "email" && sb.threadId ? (
                        <span className="text-sm">
                          {sb.threadSubject ?? "Email thread"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(sb.lastActivityAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <SandboxActions
                        sandbox={sb}
                        capabilities={providerCapabilities(
                          providerStatus.data,
                          sb.provider,
                        )}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
