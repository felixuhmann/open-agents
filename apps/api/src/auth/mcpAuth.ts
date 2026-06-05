import { auth } from "./index.js";
import { config } from "../config.js";

export type McpAuthContext = {
  userId: string;
  authHeaders: Headers;
};

export function mcpUnauthorizedResponse(): Response {
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const wwwAuthenticate = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`;
  return Response.json(
    {
      error:
        "unauthorized — connect via OAuth or provide Authorization: Bearer <session_token>",
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": wwwAuthenticate,
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    },
  );
}

/**
 * Accept either a better-auth session token (legacy MCP tokens / manual config)
 * or an OAuth access token issued through the MCP plugin.
 */
export async function resolveMcpAuth(request: Request): Promise<McpAuthContext | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.user) {
    return { userId: session.user.id, authHeaders: request.headers };
  }

  const oauth = await auth.api.getMcpSession({
    headers: request.headers,
  });
  if (!oauth?.userId) {
    return null;
  }

  const expiresAt =
    oauth.accessTokenExpiresAt instanceof Date
      ? oauth.accessTokenExpiresAt
      : new Date(String(oauth.accessTokenExpiresAt));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return null;
  }

  return { userId: oauth.userId, authHeaders: request.headers };
}
