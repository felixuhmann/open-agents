import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodObject, type ZodRawShape } from "zod";
import { formatProxyResult, proxyApiRequest, type ApiProxyRequest } from "./apiProxy.js";
import type { ControlPlaneMcpContext } from "./context.js";

type HttpMethod = ApiProxyRequest["method"];

export type ControlPlaneToolAuth = "public" | "user" | "operator" | "admin";

export type ControlPlaneToolDef<T extends ZodObject<ZodRawShape>> = {
  /** MCP tool name (snake_case, OpenAI-compatible). */
  name: string;
  title: string;
  /** Human description; auth requirement is appended automatically. */
  description: string;
  auth: ControlPlaneToolAuth;
  method: HttpMethod;
  /** REST path template, e.g. `/api/agents/:slug`. */
  path: string;
  /** Zod object describing all tool arguments (path, query, and body fields). */
  input: T;
  /** Path parameter names matching `:name` segments in `path`. */
  pathParams?: readonly string[];
  /** Input keys forwarded as query string (for GET/DELETE). */
  queryFields?: readonly string[];
  /** Extra notes appended to the tool description (SSE, binary, etc.). */
  notes?: string;
};

function authLabel(auth: ControlPlaneToolAuth): string {
  switch (auth) {
    case "public":
      return "No auth required.";
    case "user":
      return "Requires a signed-in user.";
    case "operator":
      return "Requires contributor or admin role.";
    case "admin":
      return "Requires admin role.";
  }
}

function scalarToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  throw new Error("expected a scalar path or query parameter");
}

function interpolatePath(template: string, params: Record<string, string>): string {
  return template.replace(/:([a-zA-Z][a-zA-Z0-9]*)/g, (_, key: string) => {
    const value = params[key];
    if (!value) throw new Error(`missing path parameter: ${key}`);
    return encodeURIComponent(value);
  });
}

function buildProxyRequest<T extends ZodObject<ZodRawShape>>(
  def: ControlPlaneToolDef<T>,
  raw: z.infer<T>,
): ApiProxyRequest {
  const pathParamNames = def.pathParams ?? [];
  const queryFieldNames = new Set(def.queryFields ?? []);
  const pathValues: Record<string, string> = {};
  const query: Record<string, string> = {};
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (pathParamNames.includes(key)) {
      pathValues[key] = scalarToString(value);
      continue;
    }
    if (queryFieldNames.has(key)) {
      query[key] = scalarToString(value);
      continue;
    }
    if (def.method === "GET" || def.method === "DELETE") {
      query[key] = scalarToString(value);
      continue;
    }
    body[key] = value;
  }

  const path = interpolatePath(def.path, pathValues);
  const hasQuery = Object.keys(query).length > 0;
  const hasBody = Object.keys(body).length > 0;

  return {
    method: def.method,
    path,
    query: hasQuery ? query : undefined,
    body: hasBody ? body : undefined,
  };
}

function fullDescription(def: ControlPlaneToolDef<ZodObject<ZodRawShape>>): string {
  const parts = [def.description.trim(), authLabel(def.auth)];
  if (def.notes?.trim()) parts.push(def.notes.trim());
  return parts.join(" ");
}

export function defineControlPlaneTool<T extends ZodObject<ZodRawShape>>(
  def: ControlPlaneToolDef<T>,
): ControlPlaneToolDef<T> {
  return def;
}

export function registerControlPlaneTools(
  server: McpServer,
  ctx: ControlPlaneMcpContext,
  tools: ControlPlaneToolDef<ZodObject<ZodRawShape>>[],
): void {
  for (const def of tools) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: fullDescription(def),
        inputSchema: def.input.shape,
      },
      async (input) => {
        try {
          const parsed = def.input.parse(input);
          const request = buildProxyRequest(def, parsed);
          const result = await proxyApiRequest(ctx.app, request, ctx.authHeaders);
          return {
            content: [{ type: "text", text: formatProxyResult(result) }],
            isError: result.status >= 400,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `${def.name} failed: ${msg}` }],
            isError: true,
          };
        }
      },
    );
  }
}

/** Reusable path param for slug-based resources. */
export const slugParam = { slug: z.string().min(1).describe("Resource slug") } as const;

export const idParam = { id: z.string().min(1).describe("Resource id") } as const;
