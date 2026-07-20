import type { ZodObject, ZodRawShape, z } from "zod";

/**
 * Context passed to every platform-tool handler invocation. Lets handlers
 * scope their work to the agent that owns the binding and reach per-binding
 * config + secrets without each handler re-fetching them.
 */
export type PlatformHandlerCtx = {
  /** Agent id that owns the binding this tool was invoked through. */
  agentId: string;
  /** Agent slug, useful for logging. */
  agentSlug: string;
  /** Per-binding config the admin set in the UI. Empty object if none. */
  configJson: Record<string, unknown>;
  /** Per-binding secrets (decrypted). Empty object if none. */
  secrets: Record<string, string>;
  /**
   * Active sandbox for run-scoped platform tools. Undefined for platform
   * invocations outside a Daytona-backed agent run.
   */
  sandbox?: PlatformSandboxCtx;
};

export type PlatformSandboxCtx = {
  workspaceDir: string;
  /** Download a sandbox file using the same path semantics as managed tools. */
  downloadFile(path: string): Promise<Buffer>;
  fs: {
    createFolder(path: string, mode: string): Promise<unknown>;
    uploadFile(content: Buffer, path: string): Promise<unknown>;
  };
};

/**
 * Type-erased MCP tool descriptor used by the platform registry. Handlers
 * receive args as `Record<string, unknown>` (and are responsible for
 * parsing through their own Zod schema, which `defineTool` does for them).
 *
 * We expose this erased shape because `PlatformHandler` carries a
 * heterogeneous list of tools — different shapes per tool — and a generic
 * descriptor would force the array to a single union or `unknown` shape
 * anyway.
 */
export type PlatformToolDescriptor = {
  name: string;
  description: string;
  /** JSON-Schema-shaped input for MCP `tools/list`. */
  inputShape: ZodRawShape;
  /** Handler invoked with already-parsed args. */
  handler: (input: Record<string, unknown>, ctx: PlatformHandlerCtx) => Promise<unknown>;
};

/**
 * A code-shipped platform handler. The `key` is what `Tool.key` stores
 * in the unified catalog, linking a binding row back to this code.
 */
export type PlatformHandler = {
  /** Stable key — also the value in `Tool.key` (runtime = `platform`). */
  key: string;
  /** Display name shown in the catalog UI. */
  name: string;
  description: string;
  /** Whether this handler needs per-binding secrets to function. */
  requiresSecrets?: boolean;
  /** JSON shape describing per-binding config (rendered as a form in UI). */
  configSchema?: Record<string, unknown>;
  /** MCP tool descriptors exposed to the agent when this handler is bound. */
  tools: PlatformToolDescriptor[];
};

/**
 * Helper to declare a typed tool. The Zod input is the single source of
 * truth: derives the JSON shape sent to MCP and parses incoming args, so
 * the handler sees `z.infer<...>` not `Record<string, unknown>`.
 */
export function defineTool<S extends ZodRawShape>(spec: {
  name: string;
  description: string;
  input: ZodObject<S>;
  handler: (input: z.infer<ZodObject<S>>, ctx: PlatformHandlerCtx) => Promise<unknown>;
}): PlatformToolDescriptor {
  return {
    name: spec.name,
    description: spec.description,
    inputShape: spec.input.shape,
    handler: async (raw, ctx) => spec.handler(spec.input.parse(raw), ctx),
  };
}
