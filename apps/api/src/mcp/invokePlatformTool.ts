import type { HydratedAgent } from "../agents/service.js";
import { log } from "../log.js";
import { getToolSecrets } from "../secrets/service.js";
import type { PlatformHandlerCtx } from "./types.js";
import { getPlatformHandler } from "./platform/index.js";

export type PlatformToolInvokeResult = {
  result: unknown;
  isError: boolean;
};

/**
 * Invoke a platform-runtime tool in-process on the orchestrator host.
 * Used by the MCP HTTP server and the Pi/Daytona adapter — secrets never
 * leave this process.
 */
export async function invokePlatformTool(
  agent: HydratedAgent,
  bindingId: string,
  handlerKey: string,
  toolName: string,
  args: Record<string, unknown>,
  configJson: Record<string, unknown>,
): Promise<PlatformToolInvokeResult> {
  const handler = getPlatformHandler(handlerKey);
  if (!handler) {
    return { result: `Unknown platform handler: ${handlerKey}`, isError: true };
  }

  const descriptor = handler.tools.find((t) => t.name === toolName);
  if (!descriptor) {
    return { result: `Unknown tool ${toolName} on handler ${handlerKey}`, isError: true };
  }

  const ctx: PlatformHandlerCtx = {
    agentId: agent.id,
    agentSlug: agent.slug,
    configJson,
    secrets: await getToolSecrets(bindingId),
  };

  try {
    const result = await descriptor.handler(args, ctx);
    return { result, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("platform tool error", {
      agentSlug: agent.slug,
      tool: toolName,
      handlerKey,
      err: msg,
    });
    return { result: `Error: ${msg}`, isError: true };
  }
}
