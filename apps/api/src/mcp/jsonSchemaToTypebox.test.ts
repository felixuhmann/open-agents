import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { zodShapeToTypebox } from "./jsonSchemaToTypebox.js";

// Regression: the converter used to strip every validation keyword, so the
// model never saw bounds like `maximum` and would loop retrying rejected args
// (e.g. google_drive_search with limit > 50).
void test("carries numeric constraints and defaults through to the tool schema", () => {
  const tb = zodShapeToTypebox({
    limit: z.number().int().min(1).max(50).default(20),
  }) as { properties: { limit: Record<string, unknown> } };
  assert.deepEqual(tb.properties.limit, {
    type: "integer",
    minimum: 1,
    maximum: 50,
    default: 20,
  });
});

void test("carries string constraints and enums", () => {
  const tb = zodShapeToTypebox({
    name: z.string().min(2).max(8),
    kind: z.enum(["a", "b"]),
  }) as { properties: { name: Record<string, unknown>; kind: Record<string, unknown> } };
  assert.equal(tb.properties.name.minLength, 2);
  assert.equal(tb.properties.name.maxLength, 8);
  assert.deepEqual(tb.properties.kind.enum, ["a", "b"]);
});

void test("preserves descriptions", () => {
  const tb = zodShapeToTypebox({
    q: z.string().describe("the search query"),
  }) as { properties: { q: Record<string, unknown> } };
  assert.equal(tb.properties.q.description, "the search query");
});
