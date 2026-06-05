import { Link, useParams } from "react-router-dom";
import { ChatCircleDotsIcon, PlusIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import { useAgent, useConversations, type ConversationListItem } from "@/lib/queries";
import { AgentAvatar } from "@/components/AgentAvatar";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

export default function AgentConversationsPage() {
  const { slug } = useParams<{ slug: string }>();
  const agent = useAgent(slug);
  const conversations = useConversations(slug);

  if (agent.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-64 w-full" />
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
  const items = conversations.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <AgentAvatar avatar={a.avatar} displayName={a.displayName} size="lg" />
            Conversations
          </span>
        }
        meta={a.slug}
        description={`Your chat history with ${a.displayName}.`}
        actions={
          a.webEnabled ? (
            <Button asChild>
              <Link to={`/agents/${a.slug}/chat`}>
                <PlusIcon data-icon="inline-start" />
                New chat
              </Link>
            </Button>
          ) : null
        }
      />

      {conversations.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-16" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <Card className="divide-y divide-border">
          {items.map((c, idx) => (
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
              You haven&apos;t chatted with {a.displayName} yet.
            </EmptyDescription>
          </EmptyHeader>
          {a.webEnabled ? (
            <EmptyContent>
              <Button asChild>
                <Link to={`/agents/${a.slug}/chat`}>
                  <ChatCircleDotsIcon data-icon="inline-start" />
                  Start a chat
                </Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </div>
  );
}

function ConversationRow({
  conversation,
  showSeparator,
}: {
  conversation: ConversationListItem;
  showSeparator: boolean;
}) {
  return (
    <>
      {showSeparator ? <Separator /> : null}
      <Link
        to={`/agents/${conversation.agent.slug}/chat/${conversation.id}`}
        className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/30"
      >
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-sm font-medium">{conversation.title}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(conversation.updatedAt).toLocaleString()}
          </p>
        </div>
        <ChatCircleDotsIcon className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </>
  );
}
