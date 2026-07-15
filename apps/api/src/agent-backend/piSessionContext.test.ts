import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  parsePiContext,
  piHistoryTokenBudget,
  serializePiContext,
  trimPiContext,
} from "./piSessionContext.js";

const toolTurn: AgentMessage[] = [
  { role: "user", content: "Inspect the repository", timestamp: 1 },
  {
    role: "assistant",
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    content: [
      { type: "thinking", thinking: "I should inspect it", thinkingSignature: "sig-1" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
    ],
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 2,
  },
  {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content: [{ type: "text", text: "# Project" }],
    details: { path: "README.md" },
    isError: false,
    timestamp: 3,
  },
  {
    role: "assistant",
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    content: [{ type: "text", text: "The repository is documented." }],
    usage: {
      input: 20,
      output: 8,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 28,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 4,
  },
];

void test("Pi context round-trip preserves tool calls, results, and reasoning signatures", () => {
  const restored = parsePiContext(serializePiContext(toolTurn));
  assert.deepEqual(restored, toolTurn);
});

void test("invalid or custom persisted messages are rejected instead of entering model context", () => {
  const restored = parsePiContext([
    null,
    { role: "notification", text: "UI only" },
    { role: "user", content: "valid", timestamp: 1 },
    { role: "assistant", content: "missing provider metadata" },
  ]);
  assert.deepEqual(restored, [{ role: "user", content: "valid", timestamp: 1 }]);
});

void test("context trimming keeps complete recent user turns", () => {
  const oldAssistant = toolTurn[3] as AssistantMessage;
  const oldTurn: AgentMessage[] = [
    { role: "user", content: "x".repeat(400), timestamp: 1 },
    {
      ...oldAssistant,
      content: [{ type: "text", text: "old answer" }],
      timestamp: 2,
    },
  ];
  const recentTurn = toolTurn.map(
    (message): AgentMessage =>
      ({ ...message, timestamp: message.timestamp + 10 }) as AgentMessage,
  );
  const trimmed = trimPiContext([...oldTurn, ...recentTurn], 180);
  assert.deepEqual(trimmed, recentTurn);
  assert.equal(trimmed[0]?.role, "user");
  assert.equal(
    trimmed.some((message) => message.role === "toolResult"),
    true,
  );
});

void test("history budget reserves context for system prompt, tools, and output", () => {
  assert.equal(piHistoryTokenBudget(100_000), 60_000);
  assert.equal(piHistoryTokenBudget(4_000), 2_400);
});
