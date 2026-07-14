import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpProbeDiagnostics,
  McpProbeResult,
  McpProbeStatus,
  McpProbeTool,
} from "@open-agents/types";
import { filterMcpTools } from "./toolFilter.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export type ProbeMcpServerOptions = {
  serverUrl: string;
  bearer?: string | null;
  allowedTools?: string[];
  timeoutMs?: number;
};

function toProbeTools(tools: Tool[]): McpProbeTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? (tool.inputSchema as Record<string, unknown>)
        : undefined,
  }));
}

function extractHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const rec = err as Record<string, unknown>;
  if (typeof rec.status === "number") return rec.status;
  if (typeof rec.statusCode === "number") return rec.statusCode;
  const response = rec.response;
  if (response && typeof response === "object" && "status" in response) {
    const status = (response as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  const cause = rec.cause;
  if (cause && typeof cause === "object") {
    return extractHttpStatus(cause);
  }
  return undefined;
}

function classifyProbeError(
  err: unknown,
  authProvided: boolean,
): { status: McpProbeStatus; message: string; diagnostics: McpProbeDiagnostics } {
  const httpStatus = extractHttpStatus(err);
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  const diagnostics: McpProbeDiagnostics = {
    httpStatus,
    authProvided,
    authRequired:
      httpStatus === 401 || httpStatus === 403 || /unauthorized|forbidden/.test(lower),
  };

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      status: "auth_failure",
      message:
        httpStatus === 401
          ? "Authentication failed (HTTP 401). Check the bearer token."
          : "Access denied (HTTP 403). The token may lack required scopes.",
      diagnostics: { ...diagnostics, authRequired: true },
    };
  }

  if (/timed out|timeout|etimedout/i.test(msg)) {
    return {
      status: "timeout",
      message: `Connection timed out after ${DEFAULT_TIMEOUT_MS / 1000}s.`,
      diagnostics,
    };
  }

  if (
    /unauthorized|forbidden|invalid token|bearer|authentication|access denied/i.test(
      msg,
    ) &&
    !authProvided
  ) {
    return {
      status: "auth_failure",
      message: "Server rejected the request. A bearer token may be required.",
      diagnostics: { ...diagnostics, authRequired: true },
    };
  }

  if (
    /unauthorized|forbidden|invalid token|bearer|authentication|access denied/i.test(msg)
  ) {
    return {
      status: "auth_failure",
      message: "Authentication failed. Verify the bearer token.",
      diagnostics: { ...diagnostics, authRequired: true },
    };
  }

  if (
    /econnrefused|enotfound|fetch failed|network|dns|certificate|ssl|tls|socket/i.test(
      msg,
    )
  ) {
    return {
      status: "unreachable",
      message: `Could not reach the server: ${msg}`,
      diagnostics,
    };
  }

  if (/invalid url|url/i.test(msg) && /invalid/i.test(msg)) {
    return {
      status: "unreachable",
      message: msg,
      diagnostics,
    };
  }

  if (/json|parse|protocol|mcp|handshake|initialize/i.test(msg)) {
    return {
      status: "protocol_error",
      message: `MCP protocol error: ${msg}`,
      diagnostics,
    };
  }

  return {
    status: "error",
    message: msg,
    diagnostics,
  };
}

/**
 * Connect to a third-party MCP server, discover tools, and return structured
 * diagnostics for operator UX. Always closes the client before returning.
 */
export async function probeMcpServer(
  options: ProbeMcpServerOptions,
): Promise<McpProbeResult> {
  const started = Date.now();
  const authProvided = Boolean(options.bearer?.trim());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probedAt = new Date().toISOString();

  let client: Client | null = null;

  try {
    const headers: Record<string, string> = {};
    if (options.bearer?.trim()) {
      headers.Authorization = `Bearer ${options.bearer.trim()}`;
    }

    const transport = new StreamableHTTPClientTransport(new URL(options.serverUrl), {
      requestInit: { headers },
    });
    client = new Client(
      { name: "open-agents-orchestrator", version: "1.0.0" },
      { capabilities: {} },
    );

    const connectPromise = client.connect(transport);
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`MCP connect timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    await Promise.race([connectPromise, timeout]);

    const listed = await client.listTools();
    const tools = filterMcpTools(listed.tools ?? [], options.allowedTools ?? []);
    const latencyMs = Date.now() - started;

    let serverName: string | undefined;
    let serverVersion: string | undefined;
    try {
      const serverInfo = client.getServerVersion?.();
      if (serverInfo) {
        serverName = serverInfo.name;
        serverVersion = serverInfo.version;
      }
    } catch {
      // optional metadata
    }

    return {
      ok: true,
      status: "connected",
      message: `Connected — ${tools.length} tool${tools.length === 1 ? "" : "s"} discovered.`,
      latencyMs,
      toolCount: tools.length,
      tools: toProbeTools(tools),
      diagnostics: {
        authProvided,
        serverName,
        serverVersion,
      },
      probedAt,
    };
  } catch (err) {
    const classified = classifyProbeError(err, authProvided);
    return {
      ok: false,
      status: classified.status,
      message: classified.message,
      latencyMs: Date.now() - started,
      diagnostics: classified.diagnostics,
      probedAt,
    };
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
