import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { hashPassword } from "better-auth/crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * better-auth instance for the platform. Email/password only — admin
 * creates user accounts; there's no public signup.
 *
 * The `secret` and base URL come from bootstrap env, not the encrypted
 * Secret store, because better-auth needs them to handle the very first
 * `/api/auth/sign-up` request before any DB-backed wizard has run.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.PUBLIC_BASE_URL,
  basePath: "/api/auth",
  trustedOrigins: [config.WEB_BASE_URL],
  emailAndPassword: {
    enabled: true,
    /**
     * Public signup is disabled. The first admin is created through the
     * /setup wizard; subsequent users are invited by an admin via the
     * /api/users endpoint. Both paths bypass `auth.api.signUpEmail` and
     * call `createUserWithPassword` below directly, which is fine because
     * those routes are already gated (setup: only when no users exist;
     * users: requireAdmin).
     */
    disableSignUp: true,
    requireEmailVerification: false,
    autoSignIn: false,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "member",
        required: false,
        input: false,
      },
    },
  },
  advanced: {
    cookiePrefix: "open-agents",
  },
});

export type Auth = typeof auth;

/**
 * Server-side equivalent of better-auth's `/sign-up/email` flow that does
 * NOT honor `emailAndPassword.disableSignUp` — used by trusted server
 * paths (setup wizard, admin-invites-user) where the route itself decides
 * whether the create is allowed.
 *
 * Mirrors what `internalAdapter.createUser` + `linkAccount` do inside
 * better-auth: a `User` row plus an `Account` row with
 * `providerId: "credential"` carrying the password hash. The hash format
 * matches `better-auth/crypto`'s scrypt, so subsequent
 * `auth.api.signInEmail` calls verify it without any extra config.
 */
export async function createUserWithPassword(input: {
  email: string;
  name: string;
  password: string;
  role?: "admin" | "member";
}): Promise<{ id: string; email: string; name: string | null; role: string }> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const userId = crypto.randomUUID();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        id: userId,
        email: normalizedEmail,
        name: input.name,
        role: input.role ?? "member",
        emailVerified: false,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    await tx.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: passwordHash,
      },
    });
    return user;
  });
}
