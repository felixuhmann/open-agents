import type { Context, MiddlewareHandler } from "hono";
import type { UserRole } from "@open-agents/types";
import { prisma } from "../db.js";
import type { AppVariables } from "../server/types.js";
import { auth } from "./index.js";

async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: normalizeRole(u.role),
  };
}

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
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
        c.set("user", (await loadAuthUser(session.user.id)) ?? null);
      } else {
        const oauth = await auth.api.getMcpSession({ headers: c.req.raw.headers });
        if (oauth?.userId) {
          const expiresAt =
            oauth.accessTokenExpiresAt instanceof Date
              ? oauth.accessTokenExpiresAt
              : new Date(String(oauth.accessTokenExpiresAt));
          if (!Number.isNaN(expiresAt.getTime()) && expiresAt > new Date()) {
            c.set("user", (await loadAuthUser(oauth.userId)) ?? null);
          } else {
            c.set("user", null);
          }
        } else {
          c.set("user", null);
        }
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

export function requireAgentOperator(c: AppCtx): AuthUser {
  const u = requireUser(c);
  if (!canOperateAgents(u)) {
    throw new HttpError(403, "agent operator role required");
  }
  return u;
}

export function canOperateAgents(u: AuthUser): boolean {
  return u.role === "admin" || u.role === "contributor";
}

/**
 * Authorize that the current user can use a given agent. Admins and
 * contributors always pass; members pass when the agent is org-wide OR
 * the user has an AgentAccess row.
 */
export async function requireAgentAccess(c: AppCtx, agentId: string): Promise<AuthUser> {
  const u = requireUser(c);
  if (canOperateAgents(u)) return u;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { accessMode: true, access: { where: { userId: u.id } } },
  });
  if (!agent) throw new HttpError(404, "agent not found");
  if (agent.accessMode === "everyone") return u;
  if (agent.access.length > 0) return u;
  throw new HttpError(403, "no access to this agent");
}

/**
 * Authorize that the current user can use a given workflow. Mirrors
 * `requireAgentAccess`: operators always pass; members pass when the
 * workflow is org-wide OR they have a WorkflowAccess row.
 */
export async function requireWorkflowAccess(
  c: AppCtx,
  workflowId: string,
): Promise<AuthUser> {
  const u = requireUser(c);
  if (canOperateAgents(u)) return u;
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: { accessMode: true, access: { where: { userId: u.id } } },
  });
  if (!workflow) throw new HttpError(404, "workflow not found");
  if (workflow.accessMode === "everyone") return u;
  if (workflow.access.length > 0) return u;
  throw new HttpError(403, "no access to this workflow");
}

function normalizeRole(role: string): UserRole {
  return role === "admin" || role === "contributor" ? role : "member";
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
