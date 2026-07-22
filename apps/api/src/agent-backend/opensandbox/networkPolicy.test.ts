import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNetworkPolicy,
  fingerprintNetworkPolicy,
  NETWORK_POLICY_METADATA_KEY,
  parseAllowListTargets,
  planNetworkPolicyFromMetadata,
  planNetworkPolicyUpdate,
} from "./networkPolicy.js";

void test("internet disabled produces a closed default-deny policy with no egress rules", () => {
  const { policy, rejectedEntries } = buildNetworkPolicy({
    internetEnabled: false,
    allowList: "",
    protectInternalNetwork: true,
  });
  assert.equal(policy.defaultAction, "deny");
  assert.deepEqual(policy.egress, []);
  assert.deepEqual(rejectedEntries, []);
});

void test("allowlist present flips policy to default-deny with per-domain allow rules", () => {
  const { policy } = buildNetworkPolicy({
    internetEnabled: true,
    allowList: "api.example.com, *.githubusercontent.com",
    protectInternalNetwork: true,
  });
  assert.equal(policy.defaultAction, "deny");
  assert.deepEqual(policy.egress, [
    { action: "allow", target: "api.example.com" },
    { action: "allow", target: "*.githubusercontent.com" },
  ]);
});

void test("internet enabled with no allowlist is default-allow (metadata protection delegated to server egress)", () => {
  const { policy } = buildNetworkPolicy({
    internetEnabled: true,
    allowList: "",
    protectInternalNetwork: true,
  });
  assert.equal(policy.defaultAction, "allow");
  assert.deepEqual(policy.egress, []);
});

void test("IP and CIDR entries are rejected instead of sent as unsupported rules", () => {
  const { policy, rejectedEntries } = buildNetworkPolicy({
    internetEnabled: true,
    allowList: "10.0.0.0/8, 169.254.169.254, api.example.com, ::1",
    protectInternalNetwork: true,
  });
  assert.equal(policy.defaultAction, "deny");
  assert.deepEqual(policy.egress, [{ action: "allow", target: "api.example.com" }]);
  assert.deepEqual(rejectedEntries, ["10.0.0.0/8", "169.254.169.254", "::1"]);
});

void test("parseAllowListTargets separates unsupported IP/CIDR targets", () => {
  assert.deepEqual(parseAllowListTargets("a.com, a.com , 1.2.3.4 ,, *.b.io"), {
    targets: ["a.com", "*.b.io"],
    rejected: ["1.2.3.4"],
  });
});

void test("plans an in-place FQDN rule replacement when the default stays deny", () => {
  assert.deepEqual(
    planNetworkPolicyUpdate(
      { defaultAction: "deny", egress: [{ action: "allow", target: "old.example" }] },
      { defaultAction: "deny", egress: [{ action: "allow", target: "new.example" }] },
    ),
    {
      kind: "patch",
      deleteTargets: ["old.example"],
      addRules: [{ action: "allow", target: "new.example" }],
    },
  );
});

void test("requires recreation when default action changes", () => {
  assert.deepEqual(
    planNetworkPolicyUpdate(
      { defaultAction: "allow", egress: [] },
      { defaultAction: "deny", egress: [{ action: "allow", target: "api.example" }] },
    ),
    { kind: "recreate" },
  );
});

void test("accepts reconnect only when provider metadata matches the desired policy", () => {
  const desired = {
    defaultAction: "deny" as const,
    egress: [{ action: "allow" as const, target: "api.example.com" }],
  };
  assert.equal(
    planNetworkPolicyFromMetadata(
      { [NETWORK_POLICY_METADATA_KEY]: fingerprintNetworkPolicy(desired) },
      desired,
    ),
    "noop",
  );
  assert.equal(planNetworkPolicyFromMetadata({}, desired), "recreate");
  assert.equal(
    planNetworkPolicyFromMetadata(
      {
        [NETWORK_POLICY_METADATA_KEY]: fingerprintNetworkPolicy({
          defaultAction: "deny",
          egress: [],
        }),
      },
      desired,
    ),
    "recreate",
  );
});
