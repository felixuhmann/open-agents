import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircleIcon,
  ClipboardIcon,
  KeyIcon,
  PlugsConnectedIcon,
  ShieldCheckIcon,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon weight="duotone" />
            OAuth connector (recommended)
          </CardTitle>
          <CardDescription>
            Claude Desktop and other OAuth-native MCP clients connect through the standard
            OAuth discovery flow — no manual token copy required.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {info.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : info.data ? (
            <OAuthConnectorPanel info={info.data} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claude Desktop setup</CardTitle>
          <CardDescription>
            Use the OAuth connector flow built into Claude Desktop — no config file
            editing required.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ClaudeOAuthInstructions />
        </CardContent>
      </Card>

      <Accordion type="single" collapsible className="rounded-lg border">
        <AccordionItem value="bearer" className="border-0">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="text-left">
              <p className="flex items-center gap-2 font-semibold">
                <KeyIcon weight="duotone" />
                Advanced: bearer token
              </p>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                For clients that support manual Streamable HTTP config with a static
                bearer token (for example Cursor). Claude Desktop now prefers OAuth
                connectors.
              </p>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="flex flex-col gap-6 border-t pt-6">
              <div className="flex flex-col gap-4">
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
                        This token is shown only once. Store it securely — you cannot view
                        it again after leaving this page.
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
                    No bearer tokens yet. Generate one for manual MCP client
                    configuration.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">claude_desktop_config.json</p>
                  <CopyConfigButton value={configJson} disabled={!info.data} />
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
                  {configJson || "Loading…"}
                </pre>
              </div>

              <BearerSetupInstructions />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Card>
        <CardHeader>
          <CardTitle>What you can do</CardTitle>
          <CardDescription>
            The MCP server exposes typed tools (for example{" "}
            <code className="text-xs">agents_create</code>,{" "}
            <code className="text-xs">conversations_send_message</code>) that call the
            same REST API as this UI, with JSON Schema for every argument.
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

function OAuthConnectorPanel({ info }: { info: McpConnectionInfo }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <CopyableCode value={info.mcpUrl} label="MCP URL" />
      <p className="text-muted-foreground">
        When you add a custom MCP connector in Claude Desktop, paste the MCP URL above.
        Claude discovers OAuth settings automatically and opens a browser sign-in window
        for this deployment.
      </p>
    </div>
  );
}

function ClaudeOAuthInstructions() {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="font-medium">1. Open Claude Desktop settings</p>
        <p className="mt-1 text-muted-foreground">
          Go to Settings → Connectors (or Integrations) and choose to add a custom MCP
          server / OAuth connector.
        </p>
      </div>
      <div>
        <p className="font-medium">2. Enter the MCP server URL</p>
        <p className="mt-1 text-muted-foreground">
          Paste the MCP URL from above (for example{" "}
          <code className="text-xs">https://your-deployment.example.com/mcp</code>).
          Claude fetches OAuth metadata from{" "}
          <code className="text-xs">/.well-known/oauth-protected-resource</code>{" "}
          automatically.
        </p>
      </div>
      <div>
        <p className="font-medium">3. Sign in when prompted</p>
        <p className="mt-1 text-muted-foreground">
          Claude opens a browser window to this deployment&apos;s login page. Use the same
          email and password as the web UI. If consent is requested, approve access on the
          consent screen.
        </p>
      </div>
      <div>
        <p className="font-medium">4. Use the connector in chat</p>
        <p className="mt-1 text-muted-foreground">
          After connecting, ask Claude to use typed tools such as{" "}
          <code className="text-xs">agents_create</code> or{" "}
          <code className="text-xs">agents_list</code> — each tool includes the request
          schema in its description.
        </p>
      </div>
    </div>
  );
}

function BearerSetupInstructions() {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="font-medium">Manual config file locations</p>
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
      <p className="text-muted-foreground">
        Merge the JSON block above into your client config, generate a token, and restart
        the client. Prefer the OAuth connector flow for Claude Desktop when available.
      </p>
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
          <Badge variant="secondary">Bearer token</Badge>
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
