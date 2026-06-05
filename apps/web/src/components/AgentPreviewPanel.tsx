import { Link } from "react-router-dom";
import {
  ChatCircleDotsIcon,
  EnvelopeIcon,
  GlobeIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import type { AgentSummaryDto } from "@open-agents/types";
import { avatarSrc, useAgent } from "@/lib/queries";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type AgentPreviewPanelProps = {
  slug: string;
  summary: AgentSummaryDto;
  /** When false, skips fetching full agent details until the hover card opens. */
  enabled?: boolean;
};

export function AgentPreviewPanel({
  slug,
  summary,
  enabled = true,
}: AgentPreviewPanelProps) {
  const agent = useAgent(enabled ? slug : undefined);
  const a = agent.data;
  const reachableEmail =
    a?.emailEnabled && a.mailgunDomain
      ? `${a.inboundLocalPart || a.slug}@${a.mailgunDomain}`
      : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-start gap-3">
          <Avatar>
            {summary.avatar ? (
              <AvatarImage src={avatarSrc(summary.avatar)} alt={summary.displayName} />
            ) : null}
            <AvatarFallback className="bg-primary text-primary-foreground">
              {summary.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">{summary.displayName}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{summary.slug}</p>
            {summary.description ? (
              <p className="mt-1 line-clamp-2 text-muted-foreground">
                {summary.description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="capitalize">
            {summary.accessMode}
          </Badge>
          {summary.webEnabled ? (
            <Badge variant="secondary">
              <GlobeIcon data-icon="inline-start" />
              web
            </Badge>
          ) : null}
          {summary.emailEnabled ? (
            <Badge variant="secondary">
              <EnvelopeIcon data-icon="inline-start" />
              email
            </Badge>
          ) : null}
        </div>
      </div>

      <Separator />

      <ScrollArea className="max-h-72">
        <div className="flex flex-col gap-3 p-4">
          {agent.isLoading ? (
            <>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[80%]" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : a ? (
            <>
              <PreviewRow label="Published version">
                {a.currentVersionNumber != null ? (
                  <span className="font-mono text-xs">v{a.currentVersionNumber}</span>
                ) : (
                  <span className="text-muted-foreground">(not published)</span>
                )}
              </PreviewRow>
              {a.publishedAt ? (
                <PreviewRow label="Last published">
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.publishedAt).toLocaleString()}
                  </span>
                </PreviewRow>
              ) : null}
              <PreviewRow label="Model">
                <code className="font-mono text-xs">
                  {a.modelProvider}/{a.modelId}
                </code>
              </PreviewRow>
              {reachableEmail ? (
                <PreviewRow label="Email address">
                  <code className="max-w-[12rem] truncate font-mono text-xs">
                    {reachableEmail}
                  </code>
                </PreviewRow>
              ) : null}
              <Separator />
              <PreviewRow label="Role tools">
                <ChipList values={a.toolBindings.map((b) => b.tool.name)} />
              </PreviewRow>
              <PreviewRow label="Third-party MCP">
                <ChipList values={a.mcpServers.map((m) => m.label)} />
              </PreviewRow>
              <PreviewRow label="Skills">
                <ChipList values={a.skills.map((s) => s.name)} />
              </PreviewRow>
            </>
          ) : agent.isError ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load agent details.
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <Separator />

      <div className="flex flex-wrap gap-2 p-3">
        <Button asChild size="sm" variant="secondary">
          <Link to={`/agents/${slug}`}>
            <RobotIcon data-icon="inline-start" />
            View details
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to={`/agents/${slug}/chat`}>
            <ChatCircleDotsIcon data-icon="inline-start" />
            Open chat
          </Link>
        </Button>
      </div>
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function ChipList({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex max-w-[14rem] flex-wrap justify-end gap-1">
      {values.map((v) => (
        <Badge key={v} variant="outline">
          {v}
        </Badge>
      ))}
    </span>
  );
}
