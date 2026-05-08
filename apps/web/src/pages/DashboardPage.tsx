import { Link } from "react-router-dom";
import {
  ChatCircleDotsIcon,
  EnvelopeIcon,
  GlobeIcon,
  PlusIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { avatarSrc, useAgents, useConversations } from "@/lib/queries";
import { PageHeader, SectionHeading } from "@/components/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

export default function DashboardPage() {
  const agents = useAgents();
  const conversations = useConversations();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description="Pick an agent to chat with, or jump back into a recent conversation."
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
        <SectionHeading title="Your agents" />
        {agents.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} className="h-36" />
            ))}
          </div>
        ) : agents.data && agents.data.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agents.data.map((a) => (
              <li key={a.id}>
                <Card className="h-full transition-colors hover:bg-accent/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <Avatar className="rounded-none">
                        {a.avatar ? (
                          <AvatarImage
                            className="rounded-none"
                            src={avatarSrc(a.avatar)}
                            alt={a.displayName}
                          />
                        ) : null}
                        <AvatarFallback className="rounded-none bg-primary text-primary-foreground">
                          {a.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
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
              <EmptyTitle>No agents yet</EmptyTitle>
              <EmptyDescription>
                Create your first agent to start chatting and receiving email.
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
        {conversations.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} className="h-16" />
            ))}
          </div>
        ) : conversations.data && conversations.data.length > 0 ? (
          <Card className="divide-y divide-border">
            {conversations.data.map((c, idx) => (
              <ConversationRow key={c.id} conversation={c} showSeparator={idx > 0} />
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
                Start a chat with an agent and it will appear here.
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
  conversation: {
    id: string;
    title: string;
    agent: { slug: string; displayName: string; avatar: string | null };
    updatedAt: string;
  };
  showSeparator: boolean;
}) {
  return (
    <>
      {showSeparator ? <Separator /> : null}
      <Link
        to={`/agents/${conversation.agent.slug}/chat/${conversation.id}`}
        className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/30"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar size="sm" className="rounded-none">
            {conversation.agent.avatar ? (
              <AvatarImage
                className="rounded-none"
                src={avatarSrc(conversation.agent.avatar)}
                alt={conversation.agent.displayName}
              />
            ) : null}
            <AvatarFallback className="rounded-none bg-primary text-primary-foreground">
              {conversation.agent.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-sm font-medium">{conversation.title}</p>
            <p className="text-xs text-muted-foreground">
              {conversation.agent.displayName} ·{" "}
              {new Date(conversation.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <ChatCircleDotsIcon className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </>
  );
}
