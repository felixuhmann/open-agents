import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ChatCircleDotsIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  FlowArrowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  canOperateAgents,
  useCurrentUser,
  useIssues,
  type IssueStatus,
} from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type StatusFilter = "all" | IssueStatus;

export default function IssuesListPage() {
  const me = useCurrentUser();
  const [filter, setFilter] = useState<StatusFilter>("open");
  const issues = useIssues(filter === "all" ? undefined : filter);

  if (me.data && !canOperateAgents(me.data.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Issues"
        description="Sessions users flagged as misbehaving. Review the conversation, inspect the raw run trace, and resolve once the underlying problem is fixed."
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="open">
            <WarningCircleIcon data-icon="inline-start" />
            Open
          </TabsTrigger>
          <TabsTrigger value="resolved">
            <CheckCircleIcon data-icon="inline-start" />
            Resolved
          </TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {issues.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !issues.data || issues.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircleIcon />
            </EmptyMedia>
            <EmptyTitle>
              {filter === "resolved" ? "No resolved issues yet" : "No issues to triage"}
            </EmptyTitle>
            <EmptyDescription>
              {filter === "open"
                ? "When a user files a report, it will show up here."
                : "Nothing to show under this filter."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead>Reporter</TableHead>
                <TableHead>Surface</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Filed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.data.map((i) => {
                const targetName =
                  i.surface === "workflow"
                    ? (i.workflow?.displayName ?? "Workflow")
                    : (i.agent?.displayName ?? "Agent");
                const targetAvatar = i.agent?.avatar ?? null;
                const initials = targetName.slice(0, 2).toUpperCase();
                return (
                  <TableRow key={i.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        to={`/issues/${i.id}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        {i.surface !== "workflow" ? (
                          <AgentAvatar
                            avatar={targetAvatar}
                            displayName={targetName}
                            className="size-7"
                          />
                        ) : (
                          <Avatar className="size-7">
                            <AvatarFallback className="bg-muted text-foreground text-[10px]">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <span className="font-medium">{targetName}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/issues/${i.id}`}
                        className="flex flex-col text-sm hover:underline"
                      >
                        <span className="truncate">{i.reporterEmail}</span>
                        {i.reporterName ? (
                          <span className="text-xs text-muted-foreground truncate">
                            {i.reporterName}
                          </span>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SurfaceBadge surface={i.surface} />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/issues/${i.id}`}
                        className="block max-w-[28rem] truncate text-sm hover:underline"
                        title={i.description}
                      >
                        {i.description}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={i.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/issues/${i.id}`}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        {formatRelative(i.createdAt)}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  if (status === "resolved") {
    return (
      <Badge variant="secondary">
        <CheckCircleIcon data-icon="inline-start" />
        resolved
      </Badge>
    );
  }
  return (
    <Badge>
      <WarningCircleIcon data-icon="inline-start" />
      open
    </Badge>
  );
}

export function SurfaceBadge({ surface }: { surface: "chat" | "email" | "workflow" }) {
  return (
    <Badge variant="outline">
      {surface === "chat" ? (
        <ChatCircleDotsIcon data-icon="inline-start" />
      ) : surface === "email" ? (
        <EnvelopeSimpleIcon data-icon="inline-start" />
      ) : (
        <FlowArrowIcon data-icon="inline-start" />
      )}
      {surface}
    </Badge>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}
