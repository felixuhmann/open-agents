import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChatCircleDotsIcon,
  DotsThreeIcon,
  EnvelopeIcon,
  GlobeIcon,
  PencilSimpleIcon,
  RobotIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { AgentSummaryDto } from "@open-agents/types";
import { AgentPreviewPanel } from "@/components/AgentPreviewPanel";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { TableCell, TableRow } from "@/components/ui/table";

type AgentListRowProps = {
  agent: AgentSummaryDto;
  canManageAgents: boolean;
  onDelete: () => void;
};

export function AgentListRow({ agent: a, canManageAgents, onDelete }: AgentListRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <HoverCard openDelay={350} closeDelay={100} onOpenChange={setPreviewOpen}>
      <HoverCardTrigger asChild>
        <TableRow className="cursor-default">
          <TableCell className="font-medium">
            <Link
              to={`/agents/${a.slug}`}
              className="flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <AgentAvatar avatar={a.avatar} displayName={a.displayName} size="sm" />
              {a.displayName}
            </Link>
          </TableCell>
          <TableCell className="font-mono text-xs text-muted-foreground">
            {a.slug}
          </TableCell>
          <TableCell>
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
              {!a.webEnabled && !a.emailEnabled ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : null}
            </div>
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="capitalize">
              {a.accessMode}
            </Badge>
          </TableCell>
          <TableCell className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DotsThreeIcon weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/agents/${a.slug}`}>
                    <RobotIcon data-icon="inline-start" />
                    View details
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/agents/${a.slug}/chat`}>
                    <ChatCircleDotsIcon data-icon="inline-start" />
                    Open chat
                  </Link>
                </DropdownMenuItem>
                {canManageAgents ? (
                  <DropdownMenuItem asChild>
                    <Link to={`/agents/${a.slug}/edit`}>
                      <PencilSimpleIcon data-icon="inline-start" />
                      Edit
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canManageAgents ? (
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <TrashIcon data-icon="inline-start" />
                    Delete agent
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
      >
        <AgentPreviewPanel slug={a.slug} summary={a} enabled={previewOpen} />
      </HoverCardContent>
    </HoverCard>
  );
}
