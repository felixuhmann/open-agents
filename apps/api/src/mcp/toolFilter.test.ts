import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { filterMcpTools } from "./toolFilter.js";

const tools = [
  { name: "search_files", inputSchema: { type: "object" } },
  { name: "read_file_content", inputSchema: { type: "object" } },
  { name: "create_file", inputSchema: { type: "object" } },
] satisfies Tool[];

void test("empty allowlist preserves backwards-compatible access to all tools", () => {
  assert.deepEqual(filterMcpTools(tools, []), tools);
});

void test("configured allowlist exposes only explicitly approved tools", () => {
  assert.deepEqual(
    filterMcpTools(tools, ["search_files", "read_file_content"]).map((tool) => tool.name),
    ["search_files", "read_file_content"],
  );
});
