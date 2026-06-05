import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircleIcon,
  ClipboardIcon,
  KeyIcon,
  PlugsConnectedIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { McpConnectionInfo, McpConnectionToken } from "@open-agents/types";
import { ApiError, api } from "@/lib/api";
import { CopyButton } from "@/components/chat/CopyButton";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  useCurrentUser,
  useMcpConnectionInfo,
  useMcpConnectionTokens,
  type McpConnectionTokenSummary,
} from "@/lib/queries";

function buildClaudeDesktopConfig(mcpUrl: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "open-agents": {
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export default function McpConnectionPage() {
  const me = useCurrentUser();
  const info = useMcpConnectionInfo();
  const tokens = useMcpConnectionTokens();
  const qc = useQueryClient();
  const [revealedToken, setRevealedToken] = useState<McpConnectionToken | null>(null);

  const generateToken = useMutation({
    mutationFn: () =>
      api<McpConnectionToken>("/api/mcp-connection/tokens", { method: "POST" }),
    onSuccess: async (token) => {
      setRevealedToken(token);
      toast.success("Auth token generated");
      await qc.invalidateQueries({ queryKey: ["mcp-connection", "tokens"] });
    },
    onError: (error) =>
      toast.error("Couldn't generate token", {
        description: error instanceof ApiError ? error.message : String(error),
      }),
  });

  const revokeToken = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/mcp-connection/tokens/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Token revoked");
      await qc.invalidateQueries({ queryKey: ["mcp-connection", "tokens"] });
    },
    onError: (error) =>
      toast.error("Couldn't revoke token", {
        description: error instanceof ApiError ? error.message : String(error),
      }),
  });

  const configToken =
    revealedToken?.token ?? "PASTE_YOUR_TOKEN_HERE_OR_GENERATE_ONE_ABOVE";
  const configJson = useMemo(
    () => (info.data ? buildClaudeDesktopConfig(info.data.mcpUrl, configToken) : ""),
    [info.data, configToken],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="MCP connection"
        description="Connect Claude Desktop, Cursor, or any MCP client to manage this deployment remotely."
      />

      <Alert>
        <PlugsConnectedIcon className="size-4" />
        <AlertTitle>Control-plane access</AlertTitle>
        <AlertDescription>
          This MCP server exposes the same REST API as the web UI. External agents can
          create agents, run chats, and manage settings on your behalf using your account
          permissions ({me.data?.role ?? "member"}).
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyIcon weight="duotone" />
              Auth token
            </CardTitle>
            <CardDescription>
              Generate a bearer token for MCP clients. Tokens are separate from your
              browser session and can be revoked individually.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button
              type="button"
              onClick={() => generateToken.mutate()}
              disabled={generateToken.isPending}
              className="w-fit"
            >
              {generateToken.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <KeyIcon data-icon="inline-start" />
              )}
              Generate auth token
            </Button>

            {revealedToken ? (
              <Alert variant="default" className="border-amber-500/40 bg-amber-500/5">
                <WarningIcon className="size-4 text-amber-600" />
                <AlertTitle>Copy your token now</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <p>
                    This token is shown only once. Store it securely — you cannot view it
                    again after leaving this page.
                  </p>
                  <CopyableCode value={revealedToken.token} label="Token" />
                  <p className="text-xs text-muted-foreground">
                    Expires {formatDateTime(revealedToken.expiresAt)}
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}

            {tokens.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (tokens.data?.length ?? 0) > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Active tokens</p>
                <div className="divide-y border">
                  {tokens.data?.map((token) => (
                    <TokenRow
                      key={token.id}
                      token={token}
                      isPending={revokeToken.isPending}
                      onRevoke={() => revokeToken.mutate(token.id)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No MCP tokens yet. Generate one to connect an external client.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server endpoint</CardTitle>
            <CardDescription>
              MCP clients connect to this URL with your bearer token.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {info.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : info.data ? (
              <EndpointPanel info={info.data} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Claude Desktop setup</CardTitle>
          <CardDescription>
            Add the block below to your Claude Desktop MCP config, then restart Claude.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">claude_desktop_config.json</p>
              <CopyConfigButton value={configJson} disabled={!info.data} />
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
              {configJson || "Loading…"}
            </pre>
          </div>

          <SetupInstructions />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you can do</CardTitle>
          <CardDescription>
            The MCP server exposes <code className="text-xs">api_request</code> and{" "}
            <code className="text-xs">api_catalog</code> tools that proxy into the same
            REST API as this UI.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Create and publish agents, attach tools, skills, and third-party MCP servers
            </li>
            <li>Start conversations and send messages to agents</li>
            <li>List workflows, manage users (admin), and read analytics (operator)</li>
          </ul>
          <p className="mt-4">
            Operators can also register third-party MCP servers in the{" "}
            <Link
              to="/library/mcp"
              className="text-foreground underline underline-offset-2"
            >
              MCP library
            </Link>{" "}
            to attach external tools to individual agents.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function EndpointPanel({ info }: { info: McpConnectionInfo }) {
  return (
    <div className="flex flex-col gap-3">
      <CopyableCode value={info.mcpUrl} label="MCP URL" />
      <p className="text-xs text-muted-foreground">
        In local development, Claude Desktop should point at the API origin (
        <span className="font-mono">{info.mcpUrl}</span>
        ), not the Vite dev server port.
      </p>
    </div>
  );
}

function SetupInstructions() {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="font-medium">1. Open your config file</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong>macOS:</strong>{" "}
            <code className="text-xs">
              ~/Library/Application Support/Claude/claude_desktop_config.json
            </code>
          </li>
          <li>
            <strong>Windows:</strong>{" "}
            <code className="text-xs">%APPDATA%\Claude\claude_desktop_config.json</code>
          </li>
        </ul>
      </div>
      <div>
        <p className="font-medium">2. Merge the JSON block above</p>
        <p className="mt-1 text-muted-foreground">
          If you already have other <code className="text-xs">mcpServers</code>, add the{" "}
          <code className="text-xs">open-agents</code> entry alongside them. Generate a
          token above and replace <code className="text-xs">PASTE_YOUR_TOKEN_HERE…</code>{" "}
          in the Authorization header.
        </p>
      </div>
      <div>
        <p className="font-medium">3. Restart Claude Desktop</p>
        <p className="mt-1 text-muted-foreground">
          Fully quit and reopen Claude so it reloads MCP servers. You should see{" "}
          <code className="text-xs">open-agents</code> in the connector list with{" "}
          <code className="text-xs">api_request</code> and{" "}
          <code className="text-xs">api_catalog</code> tools.
        </p>
      </div>
      <div>
        <p className="font-medium">4. Edit your agent from Claude</p>
        <p className="mt-1 text-muted-foreground">
          Ask Claude to call <code className="text-xs">api_catalog</code> to discover
          endpoints, then use <code className="text-xs">api_request</code> — for example,{" "}
          <code className="text-xs">POST /api/agents</code> to create an agent and{" "}
          <code className="text-xs">POST /api/agents/:slug/publish</code> to publish it.
        </p>
      </div>
    </div>
  );
}

function CopyableCode({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <CopyButton getText={() => value} label={`Copy ${label}`} />
    </div>
  );
}

function CopyConfigButton({ value, disabled }: { value: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied config to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error("Couldn't copy", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
    >
      {copied ? (
        <CheckCircleIcon data-icon="inline-start" />
      ) : (
        <ClipboardIcon data-icon="inline-start" />
      )}
      Copy config
    </Button>
  );
}

function TokenRow({
  token,
  isPending,
  onRevoke,
}: {
  token: McpConnectionTokenSummary;
  isPending: boolean;
  onRevoke: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">MCP token</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {token.id.slice(0, 8)}…
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(token.createdAt)} · Expires{" "}
          {formatDateTime(token.expiresAt)}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
