import { createAuthClient } from "better-auth/react";

/**
 * better-auth client. Uses same-origin cookies. The base URL falls back to
 * the page origin so the SPA works behind any reverse proxy.
 */
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "" : window.location.origin,
  fetchOptions: { credentials: "include" },
});

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
};
