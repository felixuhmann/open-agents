import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowsClockwiseIcon,
  CloudIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { useSandboxOrphans, useSandboxes, type SandboxSummary } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
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

function SandboxActions({ sandbox }: { sandbox: SandboxSummary }) {
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
  const del = useMutation({
    mutationFn: () => api(`/api/sandboxes/${sandbox.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sandbox deleted");
    },
    onError: onActionError,
  });

  const busy = sync.isPending || stop.isPending || start.isPending || del.isPending;

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
        description="Self-hosted OpenSandbox + Kata VMs backing chat and email sessions. Stale sandboxes are paused automatically; use reconcile to sync provider state."
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

      {orphans.data?.orphans && orphans.data.orphans.length > 0 ? (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">
              Unregistered OpenSandbox sandboxes
            </CardTitle>
            <CardDescription>
              These sandboxes exist in OpenSandbox with open-agents labels but no database
              row.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground">
              {orphans.data.orphans.map((o) => (
                <li key={o.providerSandboxId}>
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
            {["", "started", "stopped", "error"].map((s) => (
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
                      <SandboxActions sandbox={sb} />
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
