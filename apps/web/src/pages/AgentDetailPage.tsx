import { Link, useParams } from "react-router-dom";
import {
  ChatCircleDotsIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  EnvelopeIcon,
  GlobeIcon,
  PencilSimpleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { avatarSrc, canOperateAgents, useAgent, useCurrentUser } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

export default function AgentDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const agent = useAgent(slug);
  const user = useCurrentUser();
  const canManageAgents = canOperateAgents(user.data?.role);

  if (agent.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (!agent.data) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningOctagonIcon />
          </EmptyMedia>
          <EmptyTitle>Agent not found</EmptyTitle>
          <EmptyDescription>
            That slug doesn&apos;t map to an agent in this deployment.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const a = agent.data;
  const reachableEmail =
    a.emailEnabled && a.mailgunDomain
      ? `${a.inboundLocalPart || a.slug}@${a.mailgunDomain}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar size="lg">
              {a.avatar ? (
                <AvatarImage src={avatarSrc(a.avatar)} alt={a.displayName} />
              ) : null}
              <AvatarFallback className="bg-primary text-primary-foreground">
                {a.displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {a.displayName}
          </span>
        }
        meta={a.slug}
        description={a.description ?? undefined}
        actions={
          <>
            <Button asChild>
              <Link to={`/agents/${a.slug}/chat`}>
                <ChatCircleDotsIcon data-icon="inline-start" />
                Open chat
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/agents/${a.slug}/conversations`}>
                <ClockCounterClockwiseIcon data-icon="inline-start" />
                History
              </Link>
            </Button>
            {canManageAgents ? (
              <Button asChild variant="outline">
                <Link to={`/agents/${a.slug}/edit`}>
                  <PencilSimpleIcon data-icon="inline-start" />
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Row label="Web chat">
              {a.webEnabled ? (
                <Badge>
                  <GlobeIcon data-icon="inline-start" />
                  enabled
                </Badge>
              ) : (
                <Badge variant="outline">disabled</Badge>
              )}
            </Row>
            <Row label="Email">
              {a.emailEnabled ? (
                <Badge>
                  <EnvelopeIcon data-icon="inline-start" />
                  enabled
                </Badge>
              ) : (
                <Badge variant="outline">disabled</Badge>
              )}
            </Row>
            <Separator />
            <Row label="Published version">
              <span className="font-mono text-xs">
                {a.currentVersionNumber != null ? (
                  `v${a.currentVersionNumber}`
                ) : (
                  <span className="text-muted-foreground">(not published)</span>
                )}
              </span>
            </Row>
            {a.publishedAt ? (
              <Row label="Last published">
                <span className="text-xs text-muted-foreground">
                  {new Date(a.publishedAt).toLocaleString()}
                </span>
              </Row>
            ) : null}
            <Row label="Model">
              <code className="font-mono text-xs">
                {a.modelProvider}/{a.modelId}
              </code>
            </Row>
            {reachableEmail ? (
              <Row label="Email address">
                <span className="inline-flex items-center justify-end gap-1">
                  <code className="font-mono text-xs">{reachableEmail}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Copy email address"
                    onClick={() => void navigator.clipboard.writeText(reachableEmail)}
                  >
                    <CopyIcon />
                  </Button>
                </span>
              </Row>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capabilities</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Row label="Role tools">
              <ChipList values={a.toolBindings.map((b) => b.tool.name)} />
            </Row>
            <Row label="Third-party MCP">
              <ChipList values={a.mcpServers.map((m) => m.label)} />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          <CardContent>
            {a.skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">None attached</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {a.skills.map((s) => (
                  <Badge key={s.id} variant="secondary">
                    {s.name}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ChipList({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {values.map((v) => (
        <Badge key={v} variant="outline">
          {v}
        </Badge>
      ))}
    </span>
  );
}
