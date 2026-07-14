const REFRESH_SKEW_MS = 60_000;

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAtMs: number;
};

export type OAuthRefreshResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresInSeconds: number;
};

export async function resolveValidAccessToken(
  tokens: OAuthTokenSet,
  input: {
    nowMs?: number;
    refresh: (refreshToken: string) => Promise<OAuthRefreshResult>;
  },
): Promise<{ accessToken: string; changed: boolean; tokens: OAuthTokenSet }> {
  const nowMs = input.nowMs ?? Date.now();
  if (tokens.expiresAtMs > nowMs + REFRESH_SKEW_MS) {
    return { accessToken: tokens.accessToken, changed: false, tokens };
  }
  if (!tokens.refreshToken) {
    throw new Error("OAuth connection expired and cannot refresh; reconnect the account");
  }

  const refreshed = await input.refresh(tokens.refreshToken);
  const next: OAuthTokenSet = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    tokenType: refreshed.tokenType ?? tokens.tokenType,
    expiresAtMs: nowMs + refreshed.expiresInSeconds * 1_000,
  };
  return { accessToken: next.accessToken, changed: true, tokens: next };
}
