import assert from "node:assert/strict";
import test from "node:test";
import { isPastAutoStopInterval } from "./sandboxLifecyclePolicy.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");

void test("uses each sandbox lifecycle policy auto-stop interval", () => {
  assert.equal(
    isPastAutoStopInterval(new Date("2026-07-20T11:45:00.000Z"), NOW, {
      autoStopInterval: 15,
      autoArchiveInterval: -1,
      autoDeleteInterval: -1,
    }),
    true,
  );
  assert.equal(
    isPastAutoStopInterval(new Date("2026-07-20T11:46:00.000Z"), NOW, {
      autoStopInterval: 15,
      autoArchiveInterval: -1,
      autoDeleteInterval: -1,
    }),
    false,
  );
});

void test("negative auto-stop interval disables automatic pause", () => {
  assert.equal(
    isPastAutoStopInterval(new Date("2020-01-01T00:00:00.000Z"), NOW, {
      autoStopInterval: -1,
      autoArchiveInterval: -1,
      autoDeleteInterval: -1,
    }),
    false,
  );
});
