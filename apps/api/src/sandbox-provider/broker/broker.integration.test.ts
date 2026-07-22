import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SANDBOX_POLICY, type SandboxPolicyBundle } from "@open-agents/types";
import { resolveBrokerConfig } from "./config.js";
import { createBrokerSandboxProvider } from "./index.js";
import type { SandboxHandle } from "../types.js";

/**
 * The adapter against a **real** broker.
 *
 * Runs only when `SANDBOX_BROKER_URL` (plus a token or token file) is present,
 * so a normal `pnpm test` on a Daytona-only checkout stays hermetic. Bring one
 * up with the broker repository's `compose.example.yaml`, then:
 *
 *   SANDBOX_BROKER_URL=http://127.0.0.1:8080 \
 *   SANDBOX_BROKER_TOKEN=... \
 *   pnpm --filter @open-agents/api test
 *
 * Everything here goes through `BrokerSandboxProvider`, not the client, so it
 * exercises exactly what the Pi runtime uses.
 */

const config = await resolveBrokerConfig(process.env as never).catch(() => null);
const skip = config
  ? false
  : "set SANDBOX_BROKER_URL (+ token) to run broker integration tests";

function policy(
  overrides: Partial<SandboxPolicyBundle["network"]> = {},
): SandboxPolicyBundle {
  return {
    network: { ...DEFAULT_SANDBOX_POLICY.network, ...overrides },
    command: { ...DEFAULT_SANDBOX_POLICY.command, maxRuntimeSeconds: 120 },
  };
}

void test("broker integration", { skip }, async (t) => {
  const provider = createBrokerSandboxProvider(config!);
  const created: string[] = [];

  t.after(async () => {
    for (const id of created) {
      await provider.delete(id).catch(() => undefined);
    }
  });

  async function newSandbox(
    net: Partial<SandboxPolicyBundle["network"]> = {},
  ): Promise<SandboxHandle> {
    const handle = await provider.create({
      agentId: "integration-agent",
      policy: policy(net),
    });
    created.push(handle.providerSandboxId);
    return handle;
  }

  await t.test("the broker is ready and reports v1 capabilities", async () => {
    const health = await provider.health();
    assert.equal(health.available, true, health.detail);
    assert.equal(provider.capabilities.archive, false);
    assert.equal(provider.capabilities.recover, false);
    assert.deepEqual([...provider.capabilities.networkModes].sort(), [
      "deny-all",
      "unrestricted",
    ]);
  });

  await t.test("create, exec, and stream output", async () => {
    const handle = await newSandbox();
    assert.equal(handle.workspaceDir, "/workspace");

    const chunks: string[] = [];
    const result = await handle.exec({
      command: "echo out; echo err 1>&2; exit 7",
      policy: policy(),
      onOutput: (chunk) => chunks.push(chunk.text),
    });

    assert.equal(result.exitCode, 7);
    assert.match(result.stdout, /out/);
    assert.match(result.stderr, /err/);
    assert.ok(chunks.join("").includes("out"));
  });

  await t.test("binary files round-trip and removePath deletes", async () => {
    const handle = await newSandbox();
    const bytes = new Uint8Array([0, 255, 27, 128, 10, 195, 40]);

    await handle.writeFile("/workspace/nested/blob.bin", bytes);
    assert.deepEqual(await handle.readFile("/workspace/nested/blob.bin"), bytes);

    await handle.removePath("/workspace/nested", { recursive: true });
    await assert.rejects(handle.readFile("/workspace/nested/blob.bin"));
  });

  await t.test("makeDir and searchFiles work over exec", async () => {
    const handle = await newSandbox();
    await handle.makeDir("/workspace/src/deep");
    await handle.writeFile(
      "/workspace/src/deep/a.ts",
      new TextEncoder().encode("export {};"),
    );
    await handle.writeFile("/workspace/src/b.js", new TextEncoder().encode("//"));

    const found = await handle.searchFiles("/workspace", "**/*.ts");
    assert.deepEqual(found.files, ["/workspace/src/deep/a.ts"]);
  });

  await t.test("a timeout returns 124 and the next command still succeeds", async () => {
    const handle = await newSandbox();
    const timed = await handle.exec({
      command: "sleep 30",
      timeoutSeconds: 2,
      policy: policy(),
    });
    assert.equal(timed.exitCode, 124);

    const after = await handle.exec({ command: "echo alive", policy: policy() });
    assert.equal(after.exitCode, 0);
    assert.match(after.stdout, /alive/);
  });

  await t.test(
    "an aborted command is cancelled and the next one still succeeds",
    async () => {
      const handle = await newSandbox();
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1_500);

      const cancelled = await handle.exec({
        command: "sleep 30",
        timeoutSeconds: 60,
        policy: policy(),
        signal: controller.signal,
      });
      assert.equal(cancelled.exitCode, 130);

      const after = await handle.exec({ command: "echo alive", policy: policy() });
      assert.equal(after.exitCode, 0);
    },
  );

  await t.test("workspace survives stop/start and the policy is re-applied", async () => {
    const handle = await newSandbox();
    await handle.writeFile("/workspace/keep.txt", new TextEncoder().encode("persisted"));

    const id = handle.providerSandboxId;
    assert.equal((await provider.stop(id)).state, "stopped");
    assert.equal((await provider.start(id)).state, "started");

    const reconnected = await provider.connect(id);
    const bytes = await reconnected.readFile("/workspace/keep.txt");
    assert.equal(new TextDecoder().decode(bytes), "persisted");
  });

  await t.test("deny-all sandboxes have no public egress", async () => {
    const handle = await newSandbox({ internetEnabled: false });
    // No trailing command: the exit code must be curl's own, not a shell
    // builtin's, or this assertion would pass no matter what the network did.
    const result = await handle.exec({
      command: "curl -s -m 5 -o /dev/null -w '%{http_code}' https://example.com",
      policy: policy({ internetEnabled: false }),
    });
    assert.notEqual(result.exitCode, 0, result.combined);
    assert.ok(!result.stdout.includes("200"), result.combined);

    // DNS must fail too, not merely the connection.
    const dns = await handle.exec({
      command: "getent hosts example.com",
      policy: policy({ internetEnabled: false }),
    });
    assert.notEqual(dns.exitCode, 0, dns.combined);
  });

  await t.test(
    "unrestricted sandboxes reach the public internet but not the metadata IP",
    async () => {
      const handle = await newSandbox({ internetEnabled: true });

      const publicProbe = await handle.exec({
        command: "curl -s -m 15 -o /dev/null -w '%{http_code}' https://example.com",
        policy: policy(),
      });
      assert.match(publicProbe.stdout, /^(200|30\d)$/);

      // Uses the provider's own policy path: the shell guard must refuse this
      // before the packet is even attempted.
      const metadata = await handle.exec({
        command: "curl -s -m 5 http://169.254.169.254/latest/meta-data/",
        policy: policy({ protectInternalNetwork: false }),
      });
      assert.ok(metadata.policyBlocked, metadata.combined);
    },
  );

  await t.test("a CIDR allowlist fails closed", async () => {
    await assert.rejects(
      provider.create({
        agentId: "integration-agent",
        policy: policy({ allowList: "10.0.0.0/8" }),
      }),
      /does not support CIDR allowlists/,
    );
  });

  await t.test(
    "listOwned reports the sandboxes we created, and delete removes them",
    async () => {
      const handle = await newSandbox();
      const id = handle.providerSandboxId;

      const listed: string[] = [];
      for await (const snapshot of provider.listOwned())
        listed.push(snapshot.providerSandboxId);
      assert.ok(listed.includes(id));

      await provider.delete(id);
      created.splice(created.indexOf(id), 1);
      await assert.rejects(provider.inspect(id));
    },
  );
});
