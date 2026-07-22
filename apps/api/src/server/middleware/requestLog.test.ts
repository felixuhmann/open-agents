import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { z } from "zod";
import { AgentBackendError } from "../../agent-backend/types.js";
import { applyRequestLogMiddleware } from "./requestLog.js";
import type { AppVariables } from "../types.js";

/**
 * Sandbox-provider failures are operator-actionable answers, not server
 * faults: "the broker is unreachable", "Daytona cannot archive this
 * sandbox". Hono's default is a bare 500 with the message discarded, which
 * leaves Settings showing "internal error" and an admin with nothing to fix.
 */

function appThatThrows(err: unknown) {
  const app = new Hono<{ Variables: AppVariables }>();
  applyRequestLogMiddleware(app, ["/api"]);
  app.get("/api/boom", () => {
    throw err;
  });
  return app;
}

async function body(res: Response): Promise<{ error?: string }> {
  return (await res.json()) as { error?: string };
}

void test("an unavailable provider surfaces as 503 with the reason intact", async () => {
  const app = appThatThrows(
    new AgentBackendError(
      'Cannot create a sandbox: the active sandbox provider "broker" is unavailable.',
      { status: 503 },
    ),
  );

  const res = await app.request("/api/boom");

  assert.equal(res.status, 503);
  assert.match((await body(res)).error ?? "", /broker/);
});

void test("an unsupported lifecycle capability surfaces as 409, not 500", async () => {
  const app = appThatThrows(
    new AgentBackendError('Sandbox provider "broker" does not support archive.', {
      status: 409,
    }),
  );

  const res = await app.request("/api/boom");

  assert.equal(res.status, 409);
  assert.equal(
    (await body(res)).error,
    'Sandbox provider "broker" does not support archive.',
  );
});

void test("a rejected provider selection surfaces as 400 with the unchanged-selection note", async () => {
  const app = appThatThrows(
    new AgentBackendError(
      'Cannot select sandbox provider "broker": token file is empty. The current selection is unchanged.',
      { status: 400 },
    ),
  );

  const res = await app.request("/api/boom");

  assert.equal(res.status, 400);
  assert.match((await body(res)).error ?? "", /current selection is unchanged/);
});

void test("a runtime sandbox failure stays an opaque 500", async () => {
  // No status: streaming/exec failures are genuine faults and must not leak
  // internals to the caller.
  const app = appThatThrows(new AgentBackendError("Sandbox run failed: ECONNRESET"));

  const res = await app.request("/api/boom");

  assert.equal(res.status, 500);
  assert.equal(await res.text(), "internal error");
});

void test("validation errors still map to 400 with the field path", async () => {
  const app = new Hono<{ Variables: AppVariables }>();
  applyRequestLogMiddleware(app, ["/api"]);
  app.get("/api/boom", () => {
    z.object({ provider: z.literal("broker") }).parse({ provider: "modal" });
    throw new Error("unreachable");
  });

  const res = await app.request("/api/boom");

  assert.equal(res.status, 400);
  assert.match((await body(res)).error ?? "", /^provider: /);
});

void test("a status outside the error range is not honored", async () => {
  const app = appThatThrows(Object.assign(new Error("sneaky"), { status: 200 }));

  const res = await app.request("/api/boom");

  assert.equal(res.status, 500);
});
