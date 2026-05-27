import { PlugsConnectedIcon } from "@phosphor-icons/react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * Placeholder for a deployment-wide MCP server library (stdio/HTTP
 * presets, shared credentials, health checks). Per-agent third-party MCP
 * URLs remain on the agent edit form until this ships.
 */
export default function McpLibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="MCP servers"
        description="Central registry for Model Context Protocol servers shared across agents."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugsConnectedIcon className="size-4" weight="duotone" />
            Coming soon
          </CardTitle>
          <CardDescription>
            Register MCP endpoints once, reuse them on many agents, and rotate credentials
            without editing each agent by hand.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Library presets</Badge>
            <Badge variant="secondary">Shared auth</Badge>
            <Badge variant="secondary">Connection health</Badge>
          </div>
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugsConnectedIcon />
              </EmptyMedia>
              <EmptyTitle>Not available yet</EmptyTitle>
              <EmptyDescription>
                Daytona runs already call platform tools (for example memory) and
                per-agent third-party MCP URLs configured under Agents → Edit. This page
                will add deployment-wide MCP management when the catalog model lands.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
