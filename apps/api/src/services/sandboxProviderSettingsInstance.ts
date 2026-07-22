import { sandboxProviderRegistry } from "../sandbox-provider/instance.js";
import type { SandboxProviderId } from "../sandbox-provider/types.js";
import { APP_SETTING_KEYS, getAppSetting, setAppSetting } from "./appSettings.js";
import { createSandboxProviderSettings } from "./sandboxProviderSettings.js";

/**
 * Deployment singleton wiring the provider-selection rules to the
 * `AppSetting` table and the live provider registry.
 */
export const sandboxProviderSettings = createSandboxProviderSettings({
  registry: sandboxProviderRegistry,
  readSetting: () => getAppSetting(APP_SETTING_KEYS.SANDBOX_PROVIDER),
  writeSetting: (value) => setAppSetting(APP_SETTING_KEYS.SANDBOX_PROVIDER, value),
  // Drop cached provider instances so the next resolution reflects the new
  // selection. The backend itself re-reads the active provider per call.
  onChange: () => sandboxProviderRegistry.reset(),
});

export function getActiveSandboxProviderId(): Promise<SandboxProviderId> {
  return sandboxProviderSettings.getActiveProviderId();
}
