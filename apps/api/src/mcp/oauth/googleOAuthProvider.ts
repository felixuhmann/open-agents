const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GoogleTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  tokenType: string;
  scopes?: string[];
};

type FetchLike = typeof fetch;

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes: string[];
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function parseTokenResponse(value: unknown): GoogleTokenResponse {
  if (!value || typeof value !== "object")
    throw new Error("Google returned an invalid token response");
  const data = value as Record<string, unknown>;
  if (
    typeof data.access_token !== "string" ||
    typeof data.expires_in !== "number" ||
    typeof data.token_type !== "string"
  ) {
    const description =
      typeof data.error_description === "string"
        ? data.error_description
        : typeof data.error === "string"
          ? data.error
          : "Google returned an invalid token response";
    throw new Error(`Google OAuth failed: ${description}`);
  }
  return {
    accessToken: data.access_token,
    ...(typeof data.refresh_token === "string"
      ? { refreshToken: data.refresh_token }
      : {}),
    expiresInSeconds: data.expires_in,
    tokenType: data.token_type,
    ...(typeof data.scope === "string"
      ? { scopes: data.scope.split(/\s+/).filter(Boolean) }
      : {}),
  };
}

async function postToken(
  body: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<GoogleTokenResponse> {
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const data =
      value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const description =
      typeof data.error_description === "string"
        ? data.error_description
        : typeof data.error === "string"
          ? data.error
          : `HTTP ${response.status}`;
    throw new Error(`Google OAuth failed: ${description}`);
  }
  return parseTokenResponse(value);
}

export function exchangeGoogleAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleTokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
    }),
    input.fetchImpl ?? fetch,
  );
}

export function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleTokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
    input.fetchImpl ?? fetch,
  );
}

export async function revokeGoogleToken(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const response = await fetchImpl("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  return response.ok;
}

export async function getGoogleUserEmail(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const response = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object") return null;
  const email = (data as Record<string, unknown>).email;
  return typeof email === "string" ? email : null;
}
