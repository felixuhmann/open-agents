import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function filterMcpTools(tools: Tool[], allowedTools: string[]): Tool[] {
  if (allowedTools.length === 0) return tools;
  const allowed = new Set(allowedTools);
  return tools.filter((tool) => allowed.has(tool.name));
}
