import type { McpOAuthCredential, McpServer } from "@open-agents/db";
import { HttpError } from "../../auth/middleware.js";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { log } from "../../log.js";
import { decryptMcpServerBearer } from "../mcpServerSecrets.js";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  getGoogleUserEmail,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from "./googleOAuthProvider.js";
import { sealMcpOAuthSecrets, unsealMcpOAuthSecrets } from "./mcpOAuthSecrets.js";
import { createOAuthState, derivePkceChallenge, verifyOAuthState } from "./oauthState.js";
import { resolveValidAccessToken, type OAuthTokenSet } from "./tokenManager.js";

const refreshLocks = new Map<string, Promise<string>>();

export function mcpOAuthRedirectUri(): string {
  return `${config.PUBLIC_BASE_URL}/api/mcp-servers/oauth/callback`;
}

function requireGoogleCredential(
  row: (McpServer & { oauthCredential: McpOAuthCredential | null }) | null,
): McpServer & { oauthCredential: McpOAuthCredential } {
  if (!row) throw new HttpError(404, "MCP server not found");
  if (row.authType !== "oauth2" || row.oauthCredential?.provider !== "google") {
    throw new HttpError(400, "MCP server is not configured for Google OAuth");
  }
  return row as McpServer & { oauthCredential: McpOAuthCredential };
}

export async function createMcpOAuthAuthorizationUrl(
  mcpServerId: string,
): Promise<string> {
  const row = requireGoogleCredential(
    await prisma.mcpServer.findUnique({
      where: { id: mcpServerId },
      include: { oauthCredential: true },
    }),
  );
  const state = createOAuthState({
    mcpServerId,
    signingSecret: config.UPLOAD_SIGNING_SECRET,
  });
  const { challenge } = derivePkceChallenge(state, config.UPLOAD_SIGNING_SECRET);
  return buildGoogleAuthorizationUrl({
    clientId: row.oauthCredential.clientId,
    redirectUri: mcpOAuthRedirectUri(),
    state,
    codeChallenge: challenge,
    scopes: row.oauthCredential.scopes,
  });
}

export async function completeMcpOAuthAuthorization(input: {
  state: string;
  code: string;
}): Promise<{ mcpServerId: string; subject: string | null }> {
  const state = verifyOAuthState(input.state, {
    signingSecret: config.UPLOAD_SIGNING_SECRET,
  });
  const row = requireGoogleCredential(
    await prisma.mcpServer.findUnique({
      where: { id: state.mcpServerId },
      include: { oauthCredential: true },
    }),
  );
  const existing = unsealMcpOAuthSecrets(row.oauthCredential);
  const { verifier } = derivePkceChallenge(input.state, config.UPLOAD_SIGNING_SECRET);
  const exchanged = await exchangeGoogleAuthorizationCode({
    clientId: row.oauthCredential.clientId,
    clientSecret: existing.clientSecret,
    redirectUri: mcpOAuthRedirectUri(),
    code: input.code,
    codeVerifier: verifier,
  });
  const refreshToken = exchanged.refreshToken ?? existing.refreshToken;
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token; revoke access and reconnect");
  }
  const subject = await getGoogleUserEmail(exchanged.accessToken);
  const expiresAt = new Date(Date.now() + exchanged.expiresInSeconds * 1_000);
  const sealed = sealMcpOAuthSecrets({
    clientSecret: existing.clientSecret,
    accessToken: exchanged.accessToken,
    refreshToken,
    tokenType: exchanged.tokenType,
  });
  await prisma.mcpOAuthCredential.update({
    where: { mcpServerId: row.id },
    data: {
      ...sealed,
      scopes: exchanged.scopes ?? row.oauthCredential.scopes,
      subject,
      expiresAt,
      connectedAt: new Date(),
    },
  });
  return { mcpServerId: row.id, subject };
}

export async function disconnectMcpOAuth(mcpServerId: string): Promise<void> {
  const row = requireGoogleCredential(
    await prisma.mcpServer.findUnique({
      where: { id: mcpServerId },
      include: { oauthCredential: true },
    }),
  );
  const existing = unsealMcpOAuthSecrets(row.oauthCredential);
  const tokenToRevoke = existing.refreshToken ?? existing.accessToken;
  if (tokenToRevoke) {
    try {
      const revoked = await revokeGoogleToken(tokenToRevoke);
      if (!revoked)
        log.warn("mcp-oauth: Google token revocation was rejected", { mcpServerId });
    } catch (err) {
      log.warn("mcp-oauth: Google token revocation failed", {
        mcpServerId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const sealed = sealMcpOAuthSecrets({ clientSecret: existing.clientSecret });
  await prisma.mcpOAuthCredential.update({
    where: { mcpServerId },
    data: {
      ...sealed,
      subject: null,
      expiresAt: null,
      connectedAt: null,
    },
  });
}

async function refreshMcpOAuthAccessToken(mcpServerId: string): Promise<string> {
  const row = requireGoogleCredential(
    await prisma.mcpServer.findUnique({
      where: { id: mcpServerId },
      include: { oauthCredential: true },
    }),
  );
  const secrets = unsealMcpOAuthSecrets(row.oauthCredential);
  if (!secrets.accessToken || !row.oauthCredential.expiresAt) {
    if (!secrets.refreshToken) {
      throw new Error(
        "Google Drive is not connected; an administrator must complete OAuth",
      );
    }
  }
  const current: OAuthTokenSet = {
    accessToken: secrets.accessToken ?? "",
    refreshToken: secrets.refreshToken,
    tokenType: secrets.tokenType ?? "Bearer",
    expiresAtMs: row.oauthCredential.expiresAt?.getTime() ?? 0,
  };
  const resolved = await resolveValidAccessToken(current, {
    refresh: async (refreshToken) => {
      const refreshed = await refreshGoogleAccessToken({
        clientId: row.oauthCredential.clientId,
        clientSecret: secrets.clientSecret,
        refreshToken,
      });
      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenType: refreshed.tokenType,
        expiresInSeconds: refreshed.expiresInSeconds,
      };
    },
  });
  if (resolved.changed) {
    const sealed = sealMcpOAuthSecrets({
      clientSecret: secrets.clientSecret,
      accessToken: resolved.tokens.accessToken,
      refreshToken: resolved.tokens.refreshToken,
      tokenType: resolved.tokens.tokenType,
    });
    await prisma.mcpOAuthCredential.update({
      where: { mcpServerId },
      data: {
        ...sealed,
        expiresAt: new Date(resolved.tokens.expiresAtMs),
      },
    });
  }
  return resolved.accessToken;
}

export async function resolveMcpServerBearer(server: McpServer): Promise<string | null> {
  if (server.authType === "none") return null;
  if (server.authType === "bearer") return decryptMcpServerBearer(server);
  if (server.authType !== "oauth2")
    throw new Error(`Unsupported MCP auth type: ${server.authType}`);

  const existing = refreshLocks.get(server.id);
  if (existing) return existing;
  const pending = refreshMcpOAuthAccessToken(server.id).finally(() => {
    refreshLocks.delete(server.id);
  });
  refreshLocks.set(server.id, pending);
  return pending;
}

export async function loadMcpServerBearerMap(
  rows: McpServer[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    rows.map(async (row) => {
      try {
        return [row.id, await resolveMcpServerBearer(row)] as const;
      } catch (err) {
        log.warn("mcp-oauth: credential resolution failed", {
          mcpServerId: row.id,
          err: err instanceof Error ? err.message : String(err),
        });
        return [row.id, null] as const;
      }
    }),
  );
  return new Map(
    entries.filter(
      (entry): entry is readonly [string, string] => typeof entry[1] === "string",
    ),
  );
}
