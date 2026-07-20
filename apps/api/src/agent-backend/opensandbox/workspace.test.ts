import assert from "node:assert/strict";
import test from "node:test";
import { AgentBackendError } from "../types.js";
import {
  bashCommand,
  confineToWorkspace,
  resolveSandboxPath,
  shellQuote,
} from "./workspace.js";

const WS = "/workspace";

void test("shellQuote wraps and escapes single quotes safely", () => {
  assert.equal(shellQuote("hello world"), "'hello world'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

void test("bashCommand invokes bash -lc with a quoted command", () => {
  assert.equal(bashCommand("echo hi"), "/bin/bash -lc 'echo hi'");
});

void test("resolveSandboxPath joins relative paths to the workspace and keeps absolute paths", () => {
  assert.equal(resolveSandboxPath("notes.txt", WS), "/workspace/notes.txt");
  assert.equal(resolveSandboxPath("sub/a.txt", WS), "/workspace/sub/a.txt");
  assert.equal(resolveSandboxPath("/tmp/x", WS), "/tmp/x");
  assert.equal(resolveSandboxPath("./a/../b.txt", WS), "/workspace/b.txt");
});

void test("confineToWorkspace resolves within the workspace and rejects traversal escapes", () => {
  assert.equal(confineToWorkspace("inbox/a.txt", WS), "/workspace/inbox/a.txt");
  assert.equal(
    confineToWorkspace("/workspace/inbox/a.txt", WS),
    "/workspace/inbox/a.txt",
  );
  assert.throws(() => confineToWorkspace("../etc/passwd", WS), AgentBackendError);
  assert.throws(() => confineToWorkspace("/etc/passwd", WS), AgentBackendError);
  assert.throws(() => confineToWorkspace("inbox/../../secret", WS), AgentBackendError);
});
