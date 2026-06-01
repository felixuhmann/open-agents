import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClipboardIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { AgentTracePanel } from "@/components/AgentTraceView";
import {
  canOperateAgents,
  useCurrentUser,
  useIssue,
  type IssueDetail,
} from "@/lib/queries";
import { buildSessionTraceExport } from "@/lib/sessionTraceExport";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, SurfaceBadge } from "./IssuesListPage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";

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

  if (me.data && !canOperateAgents(me.data.role)) {
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
              <CopyButton
                label="Copy compact report"
                value={JSON.stringify(buildFullExport(data), null, 2)}
              />
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

      <ReportSummaryCard data={data} />

      <AgentTracePanel data={data} />
    </div>
  );
}

function ReportSummaryCard({ data }: { data: IssueDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">What went wrong</CardTitle>
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
        <p className="whitespace-pre-wrap text-sm">{data.description}</p>
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

function buildFullExport(data: IssueDetail): unknown {
  const sessionExport = buildSessionTraceExport(data) as Record<string, unknown>;
  return {
    issue: {
      id: data.id,
      surface: data.surface,
      status: data.status,
      description: data.description,
      reporter: {
        email: data.reporterEmail,
        userId: data.reporterUserId,
        name: data.reporterName,
      },
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      resolvedAt: data.resolvedAt,
    },
    ...sessionExport,
  };
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
