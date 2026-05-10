import type { Context, MiddlewareHandler } from "hono";
import { prisma } from "../db.js";
import type { AppVariables } from "../server/types.js";
import { auth } from "./index.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
};

/** @deprecated use AppVariables from server/types.js */
export type AuthVariables = { user: AuthUser | null };

export type AppCtx = Context<{ Variables: AppVariables }>;

/**
 * Resolve the current user from better-auth's session helper and stash it
 * on the Hono context. Always continues — the per-route guards decide
 * whether unauthenticated calls are rejected.
 */
export function attachUser(): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session?.user) {
        const u = await prisma.user.findUnique({ where: { id: session.user.id } });
        if (u) {
          c.set("user", {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role === "admin" ? "admin" : "member",
          });
        } else {
          c.set("user", null);
        }
      } else {
        c.set("user", null);
      }
    } catch {
      c.set("user", null);
    }
    await next();
  };
}

export function requireUser(c: AppCtx): AuthUser {
  const u = c.get("user");
  if (!u) {
    throw new HttpError(401, "unauthorized");
  }
  return u;
}

export function requireAdmin(c: AppCtx): AuthUser {
  const u = requireUser(c);
  if (u.role !== "admin") {
    throw new HttpError(403, "admin role required");
  }
  return u;
}

/**
 * Authorize that the current user can use a given agent. `admin` always
 * passes; `member` passes when the agent is org-wide OR the user has an
 * AgentAccess row.
 */
export async function requireAgentAccess(c: AppCtx, agentId: string): Promise<AuthUser> {
  const u = requireUser(c);
  if (u.role === "admin") return u;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { accessMode: true, access: { where: { userId: u.id } } },
  });
  if (!agent) throw new HttpError(404, "agent not found");
  if (agent.accessMode === "everyone") return u;
  if (agent.access.length > 0) return u;
  throw new HttpError(403, "no access to this agent");
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
