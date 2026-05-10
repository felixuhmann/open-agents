import type { Prisma } from "@open-agents/db";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { PLATFORM_HANDLERS } from "../mcp/platform/index.js";

/**
 * Members of Anthropic's `agent_toolset_20260401`. Each is a capability
 * the model executes inside its session container — we don't ship code
 * for them, the toggle is purely "advertise this capability to the
 * agent in its published config".
 *
 * Bumping toolset versions is a one-file change: extend or replace this
 * list and the seeder upserts the new rows. To retire a member, set its
 * `deprecated` flag — existing bindings keep working until an admin
 * re-picks, but the row is hidden from the picker.
 */
const MANAGED_TOOLS: ReadonlyArray<{ key: string; name: string; description: string }> = [
  { key: "bash", name: "Bash", description: "Execute bash commands in a shell session." },
  {
    key: "read",
    name: "Read file",
    description: "Read a file from the workspace (text, image, PDF, ipynb).",
  },
  { key: "write", name: "Write file", description: "Write a file to the workspace." },
  { key: "edit", name: "Edit file", description: "String replacement in a file." },
  {
    key: "glob",
    name: "Glob",
    description: "Fast file pattern matching using glob patterns.",
  },
  { key: "grep", name: "Grep", description: "Regex text search across files." },
  { key: "web_fetch", name: "Web fetch", description: "Fetch the contents of a URL." },
  {
    key: "web_search",
    name: "Web search",
    description: "Search the web for information.",
  },
];

/**
 * Idempotent seed:
 *
 * - Upserts every code-shipped platform handler into `Tool` so the UI
 *   catalog matches `PLATFORM_HANDLERS`.
 * - Upserts the Anthropic-managed toolset members so the same UI
 *   catalog also covers backend-executed tools.
 *
 * Keys are unique across runtimes (managed `bash` and a hypothetical
 * platform `bash` would collide — that's intentional, the catalog is one
 * namespace from the admin's point of view).
 */
export async function seedToolCatalog(): Promise<void> {
  for (const tool of MANAGED_TOOLS) {
    await prisma.tool.upsert({
      where: { key: tool.key },
      create: {
        key: tool.key,
        name: tool.name,
        description: tool.description,
        runtime: "managed",
        configSchema: {},
        requiresSecrets: false,
      },
      update: {
        name: tool.name,
        description: tool.description,
        runtime: "managed",
        deprecated: false,
      },
    });
  }

  for (const handler of PLATFORM_HANDLERS) {
    const configSchema = (handler.configSchema ?? {}) as Prisma.InputJsonValue;
    await prisma.tool.upsert({
      where: { key: handler.key },
      create: {
        key: handler.key,
        name: handler.name,
        description: handler.description,
        runtime: "platform",
        configSchema,
        requiresSecrets: handler.requiresSecrets ?? false,
      },
      update: {
        name: handler.name,
        description: handler.description,
        runtime: "platform",
        configSchema,
        requiresSecrets: handler.requiresSecrets ?? false,
        deprecated: false,
      },
    });
  }

  log.info("seed: tool catalog ready", {
    managed: MANAGED_TOOLS.map((t) => t.key),
    platform: PLATFORM_HANDLERS.map((h) => h.key),
  });
}
