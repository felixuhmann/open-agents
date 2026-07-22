import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentBackendError,
  type AgentBackend,
  type AgentSession,
  type AgentStreamEvent,
  type CreateSessionInput,
  type SessionResource,
} from "./types.js";

/**
 * Characterization of the backend contract every caller (jobs, sessions,
 * attachments, subagents, workflows) codes against. The provider-neutral
 * refactor may add fields but must not change these shapes or the error type.
 */

void test("AgentBackendError keeps its name, message, and original cause", () => {
  const cause = new Error("HTTP 502");
  const err = new AgentBackendError("Daytona sandbox run failed: HTTP 502", { cause });

  assert.ok(err instanceof Error);
  assert.equal(err.name, "AgentBackendError");
  assert.equal(err.message, "Daytona sandbox run failed: HTTP 502");
  assert.equal(err.cause, cause);
});

void test("a backend implementation satisfies the four-method orchestrator contract", async () => {
  const calls: string[] = [];
  const resource: SessionResource = {
    type: "file",
    fileId: "file_1",
    mountPath: "/workspace/inbox/report.pdf",
    filename: "report.pdf",
    mime: "application/pdf",
    bytes: new Uint8Array([1, 2, 3]),
  };

  const backend: AgentBackend = {
    runtime: "daytona",
    createSession: (input: CreateSessionInput) => {
      calls.push(`createSession:${input.agentId}:${input.surface ?? "none"}`);
      return Promise.resolve({
        id: `daytona:${input.agentId}:sandbox-1`,
        providerSandboxId: "sandbox-1",
        workspaceDir: "/home/daytona",
        skillsManifest: { entries: [], materialized: 1, skipped: 0, failed: 0 },
      } satisfies AgentSession);
    },
    mountSessionResources: (sessionId, resources, observability) => {
      calls.push(
        `mount:${sessionId}:${resources.length}:${observability?.runId ?? "none"}`,
      );
      return Promise.resolve();
    },
    streamUntilIdle: (sessionId, userMessage, onEvent, context) => {
      onEvent?.({ kind: "delta", text: "hi", rawType: "pi.text_delta" });
      calls.push(`stream:${sessionId}:${userMessage}:${context?.surface ?? "none"}`);
      return Promise.resolve("hi");
    },
    uploadFile: (input) => Promise.resolve({ id: `daytona-file-${input.filename}` }),
  };

  const session = await backend.createSession({
    agentId: "agent_1",
    agentSlug: "researcher",
    surface: "chat",
    conversationId: "conv_1",
    resources: [resource],
  });
  assert.equal(session.id, "daytona:agent_1:sandbox-1");
  assert.equal(session.providerSandboxId, "sandbox-1");
  assert.equal(session.workspaceDir, "/home/daytona");
  assert.equal(session.skillsManifest?.materialized, 1);

  await backend.mountSessionResources(session.id, [resource], { runId: "run_1" });

  const events: AgentStreamEvent[] = [];
  const output = await backend.streamUntilIdle(
    session.id,
    "do the thing",
    (event) => events.push(event),
    { runId: "run_1", surface: "chat", agentId: "agent_1" },
  );
  assert.equal(output, "hi");
  assert.deepEqual(events, [{ kind: "delta", text: "hi", rawType: "pi.text_delta" }]);

  const file = await backend.uploadFile({
    filename: "a.txt",
    bytes: new Uint8Array(),
    mime: "text/plain",
  });
  assert.equal(file.id, "daytona-file-a.txt");

  assert.deepEqual(calls, [
    "createSession:agent_1:chat",
    "mount:daytona:agent_1:sandbox-1:1:run_1",
    "stream:daytona:agent_1:sandbox-1:do the thing:chat",
  ]);
});

void test("normalized stream events carry the upstream rawType for observability", () => {
  const events: AgentStreamEvent[] = [
    { kind: "reasoning", active: true, rawType: "pi.thinking_start" },
    { kind: "delta", text: "a", rawType: "pi.text_delta" },
    { kind: "message", text: "a", rawType: "pi.message_end" },
    { kind: "tool_use", toolName: "bash", rawType: "pi.tool_execution_start" },
    {
      kind: "tool_output",
      toolName: "bash",
      rawType: "daytona.command_output",
      stream: "stdout",
      text: "ok",
    },
    { kind: "tool_result", toolName: "bash", rawType: "pi.tool_execution_end" },
    { kind: "model_request_started", rawType: "pi.request_start" },
    {
      kind: "model_request",
      rawType: "pi.turn_end",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    },
    { kind: "session_error", rawType: "daytona.error", message: "boom" },
    { kind: "other", rawType: "pi.unknown" },
  ];

  assert.equal(
    events.every((event) => typeof event.rawType === "string" && event.rawType.length > 0),
    true,
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    [
      "reasoning",
      "delta",
      "message",
      "tool_use",
      "tool_output",
      "tool_result",
      "model_request_started",
      "model_request",
      "session_error",
      "other",
    ],
  );
});
