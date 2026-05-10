/**
 * Tiny `fetch` wrapper for the SPA. Always sends cookies (better-auth uses
 * cookie sessions) and throws a typed `ApiError` on non-2xx responses so
 * react-query's `onError` can narrow on `error.status`.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = ""; // same origin via vite proxy in dev, real origin in prod

export async function api<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers);
  let body = init?.body;
  if (init?.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    credentials: "include",
    ...init,
    headers,
    body,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      // body wasn't JSON
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}
