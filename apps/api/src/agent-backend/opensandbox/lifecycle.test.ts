import assert from "node:assert/strict";
import test from "node:test";
import { planConnectAction, planReconcileAction } from "./lifecycle.js";

void test("planConnectAction resumes only paused sandboxes and waits through transitions", () => {
  assert.equal(planConnectAction("started"), "connect");
  assert.equal(planConnectAction("stopped"), "resume");
  assert.equal(planConnectAction("starting"), "connect");
  assert.equal(planConnectAction("error"), "error");
  assert.equal(planConnectAction("deleted"), "error");
  assert.equal(planConnectAction("deleting"), "error");
  assert.equal(planConnectAction("creating"), "connect");
  assert.equal(planConnectAction("unknown"), "error");
});

void test("planReconcileAction clears missing/deleted, pauses stale or expired-orphan running sandboxes", () => {
  // A sandbox the provider reports deleted → clear pointers.
  assert.equal(
    planReconcileAction({
      state: "deleted",
      isOrphan: false,
      isStale: false,
      orphanExpired: false,
    }),
    "clear",
  );
  // Running + stale → pause.
  assert.equal(
    planReconcileAction({
      state: "started",
      isOrphan: false,
      isStale: true,
      orphanExpired: false,
    }),
    "pause",
  );
  // Running + orphan past grace → pause.
  assert.equal(
    planReconcileAction({
      state: "started",
      isOrphan: true,
      isStale: false,
      orphanExpired: true,
    }),
    "pause",
  );
  // Running, healthy, linked → leave running.
  assert.equal(
    planReconcileAction({
      state: "started",
      isOrphan: false,
      isStale: false,
      orphanExpired: false,
    }),
    "none",
  );
  // Already paused → nothing to do.
  assert.equal(
    planReconcileAction({
      state: "stopped",
      isOrphan: true,
      isStale: true,
      orphanExpired: true,
    }),
    "none",
  );
});
