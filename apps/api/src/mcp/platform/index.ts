import type { PlatformHandler } from "../types.js";
import { memoryHandler } from "./memory.js";

/**
 * Curated registry of platform-hosted MCP tool handlers. Adding a new
 * handler is a code change here plus a `Tool` row (auto-seeded by
 * `services/seedToolCatalog.ts` from this list).
 */
export const PLATFORM_HANDLERS: PlatformHandler[] = [memoryHandler];

const byKey = new Map(PLATFORM_HANDLERS.map((h) => [h.key, h]));

export function getPlatformHandler(key: string): PlatformHandler | undefined {
  return byKey.get(key);
}
