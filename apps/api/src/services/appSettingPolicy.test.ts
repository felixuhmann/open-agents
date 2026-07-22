import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_SETTING_KEYS,
  GENERIC_APP_SETTING_KEYS,
  isReservedAppSettingKey,
  rejectGenericAppSettingMutation,
} from "./appSettingPolicy.js";

/**
 * `sandbox_provider` may only move through `/api/sandbox-provider`, which
 * health-checks the target first and leaves the stored selection untouched
 * when it is unusable. The generic settings route writes arbitrary text, so
 * letting it through would let an admin select an unreachable provider and
 * strand every new sandbox.
 */

void test("the sandbox provider key is reserved from the generic settings surface", () => {
  assert.equal(isReservedAppSettingKey(APP_SETTING_KEYS.SANDBOX_PROVIDER), true);
  assert.equal(GENERIC_APP_SETTING_KEYS.includes(APP_SETTING_KEYS.SANDBOX_PROVIDER), false);
});

void test("branding keys stay generic", () => {
  for (const key of [
    APP_SETTING_KEYS.PRODUCT_NAME,
    APP_SETTING_KEYS.FAVICON_URL,
    APP_SETTING_KEYS.SIDEBAR_LOGO_URL,
    APP_SETTING_KEYS.EMAIL_FOOTER_LOGO_URL,
    APP_SETTING_KEYS.EMAIL_DISCLAIMER,
    APP_SETTING_KEYS.INBOUND_FROM,
  ]) {
    assert.equal(isReservedAppSettingKey(key), false, key);
    assert.equal(GENERIC_APP_SETTING_KEYS.includes(key), true, key);
    assert.equal(rejectGenericAppSettingMutation(key), null, key);
  }
});

void test("writing or deleting the reserved key is refused with the endpoint that owns it", () => {
  const rejection = rejectGenericAppSettingMutation(APP_SETTING_KEYS.SANDBOX_PROVIDER);

  assert.ok(rejection);
  assert.equal(rejection.status, 409);
  assert.match(rejection.error, /\/api\/sandbox-provider/);
});

void test("unknown keys are still a plain 400", () => {
  const rejection = rejectGenericAppSettingMutation("totally_made_up");

  assert.ok(rejection);
  assert.equal(rejection.status, 400);
  assert.equal(rejection.error, "unknown setting key");
});
