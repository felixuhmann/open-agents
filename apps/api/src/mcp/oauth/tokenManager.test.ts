import assert from "node:assert/strict";
import test from "node:test";
import { resolveValidAccessToken, type OAuthTokenSet } from "./tokenManager.js";

const baseTokens: OAuthTokenSet = {
  accessToken: "current-access",
  refreshToken: "refresh-token",
  tokenType: "Bearer",
  expiresAtMs: 120_000,
};

void test("returns a sufficiently fresh access token without refreshing", async () => {
  let refreshed = false;
  const result = await resolveValidAccessToken(baseTokens, {
    nowMs: 1_000,
    refresh: () => {
      refreshed = true;
      throw new Error("must not refresh");
    },
  });

  assert.equal(result.accessToken, "current-access");
  assert.equal(result.changed, false);
  assert.equal(refreshed, false);
});

void test("refreshes an expiring token and preserves a missing replacement refresh token", async () => {
  const result = await resolveValidAccessToken(
    { ...baseTokens, expiresAtMs: 20_000 },
    {
      nowMs: 1_000,
      refresh: (refreshToken) => {
        assert.equal(refreshToken, "refresh-token");
        return Promise.resolve({
          accessToken: "new-access",
          tokenType: "Bearer",
          expiresInSeconds: 3_600,
        });
      },
    },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.tokens, {
    accessToken: "new-access",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    expiresAtMs: 3_601_000,
  });
});

void test("cannot refresh without a refresh token", async () => {
  await assert.rejects(
    () =>
      resolveValidAccessToken(
        { accessToken: "expired", tokenType: "Bearer", expiresAtMs: 0 },
        {
          nowMs: 1_000,
          refresh: () => {
            throw new Error("unreachable");
          },
        },
      ),
    /reconnect/i,
  );
});
