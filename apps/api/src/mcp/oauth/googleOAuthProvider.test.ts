import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from "./googleOAuthProvider.js";

const config = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://agents.example.com/api/mcp-servers/server-1/oauth/callback",
};

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(init?: RequestInit): URLSearchParams {
  assert.ok(init?.body instanceof URLSearchParams);
  return init.body;
}

void test("builds a Google authorization URL for offline consent with PKCE", () => {
  const url = new URL(
    buildGoogleAuthorizationUrl({
      ...config,
      state: "signed-state",
      codeChallenge: "pkce-challenge",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
    }),
  );

  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "signed-state");
  assert.equal(url.searchParams.get("code_challenge"), "pkce-challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("scope"),
    "openid email https://www.googleapis.com/auth/drive.readonly",
  );
});

void test("exchanges an authorization code for normalized tokens", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const result = await exchangeGoogleAuthorizationCode({
    ...config,
    code: "authorization-code",
    codeVerifier: "verifier",
    fetchImpl: (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: requestUrl(url), body: requestBody(init).toString() });
      return Promise.resolve(
        Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email https://www.googleapis.com/auth/drive.readonly",
        }),
      );
    },
  });

  assert.equal(requests[0]?.url, "https://oauth2.googleapis.com/token");
  const body = new URLSearchParams(requests[0]?.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "verifier");
  assert.deepEqual(result, {
    accessToken: "access",
    refreshToken: "refresh",
    expiresInSeconds: 3600,
    tokenType: "Bearer",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
  });
});

void test("refreshes Google access tokens through the token endpoint", async () => {
  const result = await refreshGoogleAccessToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: "refresh",
    fetchImpl: (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = requestBody(init);
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "refresh");
      return Promise.resolve(
        Response.json({
          access_token: "new-access",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      );
    },
  });

  assert.deepEqual(result, {
    accessToken: "new-access",
    expiresInSeconds: 3600,
    tokenType: "Bearer",
  });
});

void test("revokes a Google refresh token", async () => {
  let capturedBody = "";
  const revoked = await revokeGoogleToken(
    "refresh-token",
    (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      assert.equal(requestUrl(url), "https://oauth2.googleapis.com/revoke");
      capturedBody = requestBody(init).toString();
      return Promise.resolve(new Response(null, { status: 200 }));
    },
  );

  assert.equal(new URLSearchParams(capturedBody).get("token"), "refresh-token");
  assert.equal(revoked, true);
});
