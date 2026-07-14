import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../log.js";
import { filterMcpTools } from "./toolFilter.js";

const CONNECT_TIMEOUT_MS = 30_000;

export type ThirdPartyMcpConnection = {
  label: string;
  serverUrl: string;
  client: Client;
  tools: Tool[];
};

/** OpenAI / Pi tool names must match `^[a-zA-Z0-9_-]+$`. */
const OPENAI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function slugifyLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "mcp";
}

function sanitizeToolNameSegment(segment: string): string {
  const cleaned = segment
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "tool";
}

/** Pi-visible tool name: `<server-slug>_<tool-name>` (OpenAI-safe). */
export function thirdPartyPiToolName(label: string, toolName: string): string {
  return `${slugifyLabel(label)}_${sanitizeToolNameSegment(toolName)}`;
}

export function isOpenAiCompatibleToolName(name: string): boolean {
  return OPENAI_TOOL_NAME_PATTERN.test(name);
}

/** Legacy Pi tool names used `<server-slug>:<tool-name>` (invalid for OpenAI). */
export function parseThirdPartyPiToolName(
  piName: string,
): { serverSlug: string; toolName: string } | null {
  const idx = piName.indexOf(":");
  if (idx <= 0) return null;
  return { serverSlug: piName.slice(0, idx), toolName: piName.slice(idx + 1) };
}

function resolveThirdPartyToolCall(
  connections: ThirdPartyMcpConnection[],
  piToolName: string,
): { conn: ThirdPartyMcpConnection; toolName: string } | null {
  for (const conn of connections) {
    const prefix = `${slugifyLabel(conn.label)}_`;
    if (piToolName.startsWith(prefix)) {
      const toolName = piToolName.slice(prefix.length);
      if (toolName) return { conn, toolName };
    }
  }

  const parsed = parseThirdPartyPiToolName(piToolName);
  if (!parsed) return null;
  const conn = connections.find((c) => slugifyLabel(c.label) === parsed.serverSlug);
  if (!conn) return null;
  return { conn, toolName: parsed.toolName };
}

/**
 * Connect to each third-party MCP server, discover tools, and return open
 * clients. Caller must call `closeThirdPartyMcpConnections` in a `finally`.
 */
export async function connectThirdPartyMcpServers(
  servers: ReadonlyArray<{
    label: string;
    serverUrl: string;
    bearer?: string | null;
    allowedTools?: string[];
  }>,
): Promise<ThirdPartyMcpConnection[]> {
  const connections: ThirdPartyMcpConnection[] = [];

  for (const server of servers) {
    try {
      const headers: Record<string, string> = {};
      if (server.bearer) {
        headers.Authorization = `Bearer ${server.bearer}`;
      }

      const transport = new StreamableHTTPClientTransport(new URL(server.serverUrl), {
        requestInit: { headers },
      });
      const client = new Client(
        { name: "open-agents-orchestrator", version: "1.0.0" },
        { capabilities: {} },
      );

      const connectPromise = client.connect(transport);
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`MCP connect timed out after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS,
        );
      });
      await Promise.race([connectPromise, timeout]);

      const listed = await client.listTools();
      const tools = filterMcpTools(listed.tools ?? [], server.allowedTools ?? []);
      connections.push({
        label: server.label,
        serverUrl: server.serverUrl,
        client,
        tools,
      });
      log.info("mcp: third-party connected", {
        label: server.label,
        serverUrl: server.serverUrl,
        toolCount: tools.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("mcp: third-party connect failed", {
        label: server.label,
        serverUrl: server.serverUrl,
        err: msg,
      });
    }
  }

  return connections;
}

export async function closeThirdPartyMcpConnections(
  connections: ThirdPartyMcpConnection[],
): Promise<void> {
  await Promise.all(
    connections.map(async (conn) => {
      try {
        await conn.client.close();
      } catch {
        // ignore close errors
      }
    }),
  );
}

export async function callThirdPartyTool(
  connections: ThirdPartyMcpConnection[],
  piToolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const resolved = resolveThirdPartyToolCall(connections, piToolName);
  if (!resolved) {
    return { text: `Invalid third-party tool name: ${piToolName}`, isError: true };
  }

  const { conn, toolName } = resolved;

  try {
    const result = await conn.client.callTool({
      name: toolName,
      arguments: args,
    });
    const text = formatMcpToolResult(result);
    return {
      text,
      isError: Boolean(
        result && typeof result === "object" && "isError" in result && result.isError,
      ),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `MCP call failed: ${msg}`, isError: true };
  }
}

export function formatMcpToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "(empty result)";
  }
  const r = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  const parts: string[] = [];
  for (const block of r.content ?? []) {
    if (block.type === "text" && block.text) parts.push(block.text);
  }
  if (r.structuredContent !== undefined) {
    parts.push(JSON.stringify(r.structuredContent, null, 2));
  }
  if (parts.length === 0) return r.isError ? "Tool returned an error." : "(empty result)";
  return parts.join("\n\n");
}
