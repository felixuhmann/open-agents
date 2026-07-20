import assert from "node:assert/strict";
import test from "node:test";
import { buildCreateSpec } from "./createSpec.js";

const NET = { internetEnabled: true, allowList: "", protectInternalNetwork: true };

void test("builds a create spec with image, keep-alive entrypoint, workspace and metadata", () => {
  const spec = buildCreateSpec({
    agentId: "agent-1",
    agentSlug: "support-bot",
    image: "ghcr.io/example/oa-guest:1.0.0",
    networkPolicy: NET,
  });
  assert.equal(spec.image, "ghcr.io/example/oa-guest:1.0.0");
  assert.deepEqual(spec.entrypoint, ["tail", "-f", "/dev/null"]);
  assert.equal(spec.workingDir, "/workspace");
  assert.equal(spec.timeoutSeconds, null);
  assert.deepEqual(spec.metadata, {
    "open-agents-agent-id": "agent-1",
    "open-agents-agent-slug": "support-bot",
  });
  assert.equal(spec.networkPolicy.defaultAction, "allow");
  assert.deepEqual(spec.rejectedNetworkEntries, []);
});

void test("fails fast for legacy IP/CIDR allowlists unsupported by OpenSandbox", () => {
  assert.throws(
    () =>
      buildCreateSpec({
        agentId: "a",
        image: "img:1",
        networkPolicy: {
          internetEnabled: true,
          allowList: "api.example.com, 10.0.0.0/8",
          protectInternalNetwork: true,
        },
      }),
    /does not support IP\/CIDR egress targets.*10\.0\.0\.0\/8/,
  );
});

void test("applies resource limits when provided and omits an empty slug", () => {
  const spec = buildCreateSpec({
    agentId: "a",
    image: "img:1",
    networkPolicy: NET,
    resourceLimits: { cpu: "2", memory: "4Gi" },
  });
  assert.deepEqual(spec.resource, { cpu: "2", memory: "4Gi" });
  assert.equal(spec.metadata["open-agents-agent-slug"], "");
});
