import {
  createSandboxBrokerClient,
  type SandboxBrokerClient,
} from "@sandbox-broker/client";

/**
 * The single place Open Agents names `@sandbox-broker/client`.
 *
 * Everything else in the adapter depends on {@link BrokerClientLike}, which is
 * *derived* from the released client class rather than restated. A method whose
 * signature changes in a future broker release therefore breaks the build here
 * and in the tests' fake, instead of silently at runtime — and swapping the
 * pinned tarball for the published release URL touches no source file.
 */

export type BrokerClientLike = Pick<
  SandboxBrokerClient,
  | "ready"
  | "capabilities"
  | "createSandbox"
  | "listSandboxes"
  | "getSandbox"
  | "startSandbox"
  | "stopSandbox"
  | "deleteSandbox"
  | "readFile"
  | "writeFile"
  | "deleteFile"
  | "exec"
>;

export type BrokerClientOptions = {
  baseUrl: string;
  token: string;
};

export function createBrokerClient(options: BrokerClientOptions): BrokerClientLike {
  return createSandboxBrokerClient(options);
}
