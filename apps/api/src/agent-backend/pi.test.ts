import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { SandboxPolicyBundle } from "@open-agents/types";
import type { HydratedAgent } from "../agents/service.js";
import type {
  SandboxExecInput,
  SandboxExecResult,
  SandboxHandle,
} from "../sandbox-provider/types.js";
import { buildRuntimePrompt } from "./prompt.js";
import { buildSandboxTools } from "./sandboxTools.js";
import type { AgentStreamEvent } from "./types.js";

/**
 * The Pi runtime is shared by every provider, so nothing here may reference
 * Daytona types or say "Daytona" to the model. These exercise the runtime
 * against a fake {@link SandboxHandle}.
 */

const POLICY: SandboxPolicyBundle = {
  network: { internetEnabled: true, allowList: "", protectInternalNetwork: true },
  command: {
    denyRules: [],
    approvalGatePatterns: [],
    maxRuntimeSeconds: 60,
    maxOutputChars: 20_000,
    maxBackgroundProcessLifetimeSeconds: 600,
  },
};

function fakeHandle(options?: {
  provider?: "daytona" | "broker";
  workspaceDir?: string;
  exec?: (input: SandboxExecInput) => SandboxExecResult;
}) {
  const files = new Map<string, Uint8Array>();
  const dirs: string[] = [];
  const execs: SandboxExecInput[] = [];
  const removed: string[] = [];

  const handle: SandboxHandle = {
    provider: options?.provider ?? "daytona",
    providerSandboxId: "sbx-1",
    workspaceDir: options?.workspaceDir ?? "/home/daytona",
    state: "started",
    exec: (input) => {
      execs.push(input);
      const result = options?.exec?.(input) ?? {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        combined: "ok",
        truncated: false,
      };
      input.onOutput?.({ stream: "stdout", text: result.stdout });
      return Promise.resolve(result);
    },
    readFile: (path) => {
      const found = files.get(path);
      if (!found) return Promise.reject(new Error(`no such file: ${path}`));
      return Promise.resolve(found);
    },
    writeFile: (path, bytes) => {
      files.set(path, bytes);
      return Promise.resolve();
    },
    makeDir: (path) => {
      dirs.push(path);
      return Promise.resolve();
    },
    searchFiles: (root, pattern) =>
      Promise.resolve({ files: [`${root}/found-${pattern}`] }),
    removePath: (path) => {
      removed.push(path);
      return Promise.resolve();
    },
  };

  return { handle, files, dirs, execs, removed };
}

function agentWithTools(keys: string[]): HydratedAgent {
  return {
    slug: "researcher",
    systemPrompt: "You are helpful.",
    toolBindings: keys.map((key) => ({
      id: `binding_${key}`,
      tool: { key, runtime: "managed" },
    })),
    skillBindings: [],
  } as unknown as HydratedAgent;
}

function textOf(result: { content: unknown[] }): string {
  const block = result.content[0] as { type?: string; text?: string } | undefined;
  return block?.text ?? "";
}

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const found = tools.find((tool) => tool.name === name);
  assert.ok(found, `expected a ${name} tool`);
  return found;
}

const NO_ATTACHMENTS = {
  storeRunAttachment: () => Promise.reject(new Error("not expected")),
};

// ---------------------------------------------------------------- prompts

void test("the runtime prompt describes a generic Linux sandbox, never Daytona", () => {
  const prompt = buildRuntimePrompt({
    agent: agentWithTools(["bash"]),
    hasTools: true,
    providerSandboxId: "sbx-1",
    workspaceDir: "/home/agent",
  });

  assert.equal(prompt.toLowerCase().includes("daytona"), false);
  assert.ok(prompt.includes("You are helpful."));
  assert.ok(prompt.includes("Linux sandbox"));
  assert.ok(prompt.includes("/home/agent"));
  assert.ok(prompt.includes("Sandbox id: sbx-1"));
});

void test("the runtime prompt says so when no sandbox tools are enabled", () => {
  const prompt = buildRuntimePrompt({
    agent: agentWithTools([]),
    hasTools: false,
    providerSandboxId: "sbx-1",
    workspaceDir: "/workspace",
  });

  assert.ok(prompt.includes("No sandbox tools are currently enabled"));
});

void test("bound skills are described with their unpacked sandbox paths", () => {
  const agent = agentWithTools(["bash"]);
  (agent as unknown as { skillBindings: unknown[] }).skillBindings = [
    {
      skill: { name: "Weekly Report" },
      skillVersion: { versionNumber: 3 },
    },
  ];

  const prompt = buildRuntimePrompt({
    agent,
    hasTools: true,
    providerSandboxId: "sbx-1",
    workspaceDir: "/home/agent",
  });

  assert.ok(
    prompt.includes("/home/agent/.agents/skills/weekly-report/SKILL.md"),
    prompt,
  );
  assert.ok(prompt.includes("pinned v3"));
});

// ------------------------------------------------------------------ tools

void test("only bound managed tools are exposed", () => {
  const tools = buildSandboxTools({
    agent: agentWithTools(["bash", "read"]),
    handle: fakeHandle().handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });

  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["bash", "read"],
  );
});

void test("attach_run_file appears only for a run and pulls bytes through the handle", async () => {
  const fake = fakeHandle();
  await fake.handle.writeFile("/home/daytona/out.bin", new Uint8Array([7, 8, 9]));

  const withoutRun = buildSandboxTools({
    agent: agentWithTools([]),
    handle: fake.handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });
  assert.deepEqual(withoutRun, []);

  const stored: { filename: string; size: number }[] = [];
  const tools = buildSandboxTools({
    agent: agentWithTools([]),
    handle: fake.handle,
    policy: POLICY,
    runId: "run_1",
    deps: {
      storeRunAttachment: (_runId, filename, contentType, buf) => {
        stored.push({ filename, size: buf.byteLength });
        return Promise.resolve({
          id: "att_1",
          filename,
          contentType,
          sizeBytes: buf.byteLength,
        });
      },
    },
  });

  const result = await toolByName(tools, "attach_run_file").execute("call-1", {
    path: "out.bin",
  });

  assert.deepEqual(stored, [{ filename: "out.bin", size: 3 }]);
  assert.ok(textOf(result).includes("att_1"));
});

void test("read and write go through the handle with workspace-relative paths resolved", async () => {
  const fake = fakeHandle({ workspaceDir: "/home/agent" });
  const tools = buildSandboxTools({
    agent: agentWithTools(["read", "write"]),
    handle: fake.handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });

  await toolByName(tools, "write").execute("call-1", {
    path: "notes/a.txt",
    content: "hello",
  });
  assert.equal(
    new TextDecoder().decode(fake.files.get("/home/agent/notes/a.txt")),
    "hello",
  );

  const read = await toolByName(tools, "read").execute("call-2", {
    path: "/home/agent/notes/a.txt",
  });
  assert.equal(textOf(read), "hello");
});

void test("the logical /workspace prefix is remapped onto the real workspace dir", async () => {
  const fake = fakeHandle({ workspaceDir: "/home/agent" });
  const tools = buildSandboxTools({
    agent: agentWithTools(["write"]),
    handle: fake.handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });

  await toolByName(tools, "write").execute("call-1", {
    path: "/workspace/inbox/a.txt",
    content: "x",
  });

  assert.ok(fake.files.has("/home/agent/inbox/a.txt"));
});

void test("edit replaces exactly one occurrence and refuses ambiguous or missing matches", async () => {
  const fake = fakeHandle({ workspaceDir: "/w" });
  await fake.handle.writeFile("/w/a.txt", new TextEncoder().encode("one two one"));
  const tools = buildSandboxTools({
    agent: agentWithTools(["edit"]),
    handle: fake.handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });
  const edit = toolByName(tools, "edit");

  await assert.rejects(
    () => edit.execute("c1", { path: "a.txt", oldString: "one", newString: "1" }),
    /more than once/,
  );
  await assert.rejects(
    () => edit.execute("c2", { path: "a.txt", oldString: "three", newString: "3" }),
    /was not found/,
  );

  await edit.execute("c3", { path: "a.txt", oldString: "two", newString: "2" });
  assert.equal(new TextDecoder().decode(fake.files.get("/w/a.txt")), "one 2 one");
});

void test("glob uses the handle's file search rather than a shell", async () => {
  const fake = fakeHandle({ workspaceDir: "/w" });
  const tools = buildSandboxTools({
    agent: agentWithTools(["glob"]),
    handle: fake.handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });

  const result = await toolByName(tools, "glob").execute("c1", { pattern: "*.ts" });

  assert.ok(textOf(result).includes("/w/found-*.ts"));
  assert.deepEqual(fake.execs, []);
});

void test("bash streams output and reports failures as tool errors", async () => {
  const fake = fakeHandle({
    workspaceDir: "/w",
    exec: () => ({
      exitCode: 3,
      stdout: "partial",
      stderr: "bad",
      combined: "partial\nbad",
      truncated: false,
    }),
  });
  const events: AgentStreamEvent[] = [];
  const tools = buildSandboxTools({
    agent: agentWithTools(["bash"]),
    handle: fake.handle,
    policy: POLICY,
    onEvent: (event) => events.push(event),
    deps: NO_ATTACHMENTS,
  });

  const result = await toolByName(tools, "bash").execute("c1", { command: "make" });

  assert.equal((result as { isError?: boolean }).isError, true);
  assert.ok(textOf(result).includes("exitCode: 3"));
  assert.equal(fake.execs[0]?.command, "make");
  assert.equal(fake.execs[0]?.cwd, "/w");

  const output = events.find((event) => event.kind === "tool_output");
  assert.ok(output);
  assert.equal(output.toolName, "bash");
  assert.equal(output.callId, "c1");
});

void test("streamed tool output identifies the provider that produced it", async () => {
  for (const provider of ["daytona", "broker"] as const) {
    const fake = fakeHandle({ provider, workspaceDir: "/w" });
    const events: AgentStreamEvent[] = [];
    const tools = buildSandboxTools({
      agent: agentWithTools(["bash"]),
      handle: fake.handle,
      policy: POLICY,
      onEvent: (event) => events.push(event),
      deps: NO_ATTACHMENTS,
    });

    await toolByName(tools, "bash").execute("c1", { command: "echo hi" });

    const output = events.find((event) => event.kind === "tool_output");
    assert.equal(output?.rawType, `${provider}.command_output`);
  }
});

void test("bash honors an explicit cwd and timeout and forwards the policy", async () => {
  const fake = fakeHandle({ workspaceDir: "/w" });
  const tools = buildSandboxTools({
    agent: agentWithTools(["bash"]),
    handle: fake.handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });

  await toolByName(tools, "bash").execute("c1", {
    command: "ls",
    cwd: "sub",
    timeoutSeconds: 5,
  });

  assert.equal(fake.execs[0]?.cwd, "/w/sub");
  assert.equal(fake.execs[0]?.timeoutSeconds, 5);
  assert.equal(fake.execs[0]?.policy, POLICY);
});

void test("grep and web_fetch run as sandbox commands", async () => {
  const fake = fakeHandle({ workspaceDir: "/w" });
  const tools = buildSandboxTools({
    agent: agentWithTools(["grep", "web_fetch"]),
    handle: fake.handle,
    policy: POLICY,
    deps: NO_ATTACHMENTS,
  });

  await toolByName(tools, "grep").execute("c1", { pattern: "TODO" });
  assert.ok(fake.execs[0]?.command.includes("grep -RIn"));
  assert.ok(fake.execs[0]?.command.includes("'TODO'"));

  await toolByName(tools, "web_fetch").execute("c2", {
    url: "https://example.com",
  });
  assert.ok(fake.execs[1]?.command.includes("https://example.com"));
});

void test("no tool description mentions Daytona", () => {
  const tools = buildSandboxTools({
    agent: agentWithTools(["bash", "read", "write", "edit", "glob", "grep", "web_fetch"]),
    handle: fakeHandle().handle,
    policy: POLICY,
    runId: "run_1",
    deps: NO_ATTACHMENTS,
  });

  for (const tool of tools) {
    assert.equal(
      tool.description.toLowerCase().includes("daytona"),
      false,
      `${tool.name} description leaks the provider name`,
    );
  }
});
