import { Link } from "react-router-dom";
import {
  ChatCircleDotsIcon,
  EnvelopeIcon,
  FlowArrowIcon,
  GlobeIcon,
  PlusIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import type { AgentSummaryDto } from "@open-agents/types";
import {
  useAgents,
  useConversations,
  useWorkflowConversations,
} from "@/lib/queries";
import { AgentAvatar } from "@/components/AgentAvatar";
import { PageHeader, SectionHeading } from "@/components/PageHeader";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

type RecentConversation =
  | {
      kind: "agent";
      id: string;
      title: string;
      updatedAt: string;
      agent: { slug: string; displayName: string; avatar: string | null };
    }
  | {
      kind: "workflow";
      id: string;
      title: string;
      updatedAt: string;
      workflow: { slug: string; displayName: string };
    };

export default function DashboardPage() {
  const agents = useAgents();
  const conversations = useConversations();
  const workflowConversations = useWorkflowConversations();
  const recentAgents =
    conversations.data && agents.data
      ? conversations.data
          .reduce<AgentSummaryDto[]>((acc, conversation) => {
            if (acc.some((agent) => agent.id === conversation.agent.id)) return acc;
            const full = agents.data.find((agent) => agent.id === conversation.agent.id);
            if (full) acc.push(full);
            return acc;
          }, [])
          .slice(0, 6)
      : [];
  const recentConversations: RecentConversation[] = [
    ...(conversations.data?.map(
      (c) =>
        ({
          kind: "agent" as const,
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
          agent: c.agent,
        }) satisfies RecentConversation,
    ) ?? []),
    ...(workflowConversations.data?.map(
      (c) =>
        ({
          kind: "workflow" as const,
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
          workflow: c.workflow,
        }) satisfies RecentConversation,
    ) ?? []),
  ]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  const conversationsLoading = conversations.isLoading || workflowConversations.isLoading;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description="Pick an agent or workflow to chat with, or jump back into a recent conversation."
        actions={
          <Button asChild>
            <Link to="/agents">
              <RobotIcon data-icon="inline-start" />
              All agents
            </Link>
          </Button>
        }
      />

      <section className="flex flex-col gap-3">
        <SectionHeading title="Recently used agents" />
        {agents.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} className="h-36" />
            ))}
          </div>
        ) : recentAgents.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {recentAgents.map((a) => (
              <li key={a.id}>
                <Card className="h-full transition-colors hover:bg-accent/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <AgentAvatar avatar={a.avatar} displayName={a.displayName} />
                      <Link
                        to={`/agents/${a.slug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {a.displayName}
                      </Link>
                    </CardTitle>
                    <CardDescription className="font-mono text-[11px]">
                      {a.slug}
                    </CardDescription>
                    <CardAction>
                      <Button asChild size="sm">
                        <Link to={`/agents/${a.slug}/chat`}>
                          <ChatCircleDotsIcon data-icon="inline-start" />
                          Chat
                        </Link>
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {a.description ? (
                      <p className="line-clamp-2 text-xs/relaxed text-foreground">
                        {a.description}
                      </p>
                    ) : null}
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
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RobotIcon />
              </EmptyMedia>
              <EmptyTitle>No recent agents yet</EmptyTitle>
              <EmptyDescription>
                Start a chat and your most recently used agents will appear here.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link to="/agents">
                  <PlusIcon data-icon="inline-start" />
                  Create an agent
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Recent conversations" />
        {conversationsLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} className="h-16" />
            ))}
          </div>
        ) : recentConversations.length > 0 ? (
          <Card className="divide-y divide-border">
            {recentConversations.map((c, idx) => (
              <ConversationRow
                key={`${c.kind}-${c.id}`}
                conversation={c}
                showSeparator={idx > 0}
              />
            ))}
          </Card>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChatCircleDotsIcon />
              </EmptyMedia>
              <EmptyTitle>No conversations yet</EmptyTitle>
              <EmptyDescription>
                Start a chat with an agent or workflow and it will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}

function ConversationRow({
  conversation,
  showSeparator,
}: {
  conversation: RecentConversation;
  showSeparator: boolean;
}) {
  const href =
    conversation.kind === "agent"
      ? `/agents/${conversation.agent.slug}/chat/${conversation.id}`
      : `/workflows/${conversation.workflow.slug}/chat/${conversation.id}`;
  const label =
    conversation.kind === "agent"
      ? conversation.agent.displayName
      : conversation.workflow.displayName;

  return (
    <>
      {showSeparator ? <Separator /> : null}
      <Link
        to={href}
        className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/30"
      >
        <div className="flex min-w-0 items-center gap-3">
          {conversation.kind === "agent" ? (
            <AgentAvatar
              avatar={conversation.agent.avatar}
              displayName={conversation.agent.displayName}
              size="sm"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <FlowArrowIcon className="size-4" />
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-sm font-medium">{conversation.title}</p>
            <p className="text-xs text-muted-foreground">
              {label} · {new Date(conversation.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <ChatCircleDotsIcon className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </>
  );
}
