import type { SandboxCommandPolicy, SandboxNetworkPolicy } from "@open-agents/types";
import { parseRegexPatterns } from "@open-agents/types";

/**
 * Lightweight guardrails for sandbox shell commands. This is not a full
 * sandbox escape hatch — Daytona still owns network and process isolation.
 * We block destructive patterns and admin-configured rules before execution.
 */

export type ShellPolicyVerdict = { allowed: true } | { allowed: false; reason: string };

export type ShellPolicyContext = {
  network?: SandboxNetworkPolicy;
  command?: SandboxCommandPolicy;
};

const BUILTIN_BLOCKED: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\/(\s|$)/,
    reason: "refusing recursive delete of filesystem root",
  },
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(\s|$)/,
    reason: "refusing recursive delete of filesystem root",
  },
  {
    pattern: /\bmkfs\./,
    reason: "refusing filesystem format commands",
  },
  {
    pattern: /\bdd\s+.*\bof=\/dev\//,
    reason: "refusing direct block-device writes",
  },
  {
    pattern: /:\(\)\s*\{\s*:\|\s*&\s*\}\s*;\s*:/,
    reason: "refusing fork bomb pattern",
  },
  {
    pattern: /\b(shutdown|reboot|poweroff|halt)\b/,
    reason: "refusing host shutdown commands",
  },
];

/** Private, loopback, and link-local targets when internal network protection is on. */
const INTERNAL_TARGET_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:curl|wget|nc|ncat|telnet|ssh|scp|rsync|ftp)\b[^\n]*\b127\./,
    reason: "refusing loopback network access (internal network protection)",
  },
  {
    pattern: /\b(?:curl|wget|nc|ncat|telnet|ssh|scp|rsync|ftp)\b[^\n]*\b10\./,
    reason: "refusing private network access (internal network protection)",
  },
  {
    pattern: /\b(?:curl|wget|nc|ncat|telnet|ssh|scp|rsync|ftp)\b[^\n]*\b192\.168\./,
    reason: "refusing private network access (internal network protection)",
  },
  {
    pattern:
      /\b(?:curl|wget|nc|ncat|telnet|ssh|scp|rsync|ftp)\b[^\n]*\b172\.(?:1[6-9]|2\d|3[01])\./,
    reason: "refusing private network access (internal network protection)",
  },
  {
    pattern: /\b(?:curl|wget|nc|ncat|telnet|ssh|scp|rsync|ftp)\b[^\n]*\b169\.254\./,
    reason: "refusing link-local network access (internal network protection)",
  },
  {
    pattern: /\b(?:curl|wget|nc|ncat|telnet|ssh|scp|rsync|ftp)\b[^\n]*\blocalhost\b/i,
    reason: "refusing localhost network access (internal network protection)",
  },
];

function matchPatterns(
  command: string,
  patterns: ReadonlyArray<{ pattern: RegExp; reason: string }>,
): ShellPolicyVerdict | null {
  for (const { pattern, reason } of patterns) {
    if (pattern.test(command)) {
      return { allowed: false, reason };
    }
  }
  return null;
}

function customPatterns(
  policy: SandboxCommandPolicy | undefined,
): ReadonlyArray<{ pattern: RegExp; reason: string }> {
  if (!policy) return [];
  const deny = parseRegexPatterns(policy.denyRules, "deny rule").map((pattern) => ({
    pattern,
    reason: "blocked by agent deny rule",
  }));
  const gates = parseRegexPatterns(policy.approvalGatePatterns, "approval gate").map(
    (pattern) => ({
      pattern,
      reason: "requires operator approval (approval gate matched; not yet automated)",
    }),
  );
  return [...deny, ...gates];
}

export function checkShellCommand(
  command: string,
  ctx: ShellPolicyContext = {},
): ShellPolicyVerdict {
  const normalized = command.trim();
  if (!normalized) {
    return { allowed: false, reason: "empty command" };
  }

  const custom = customPatterns(ctx.command);
  const blocked =
    matchPatterns(normalized, custom) ??
    matchPatterns(normalized, BUILTIN_BLOCKED) ??
    (ctx.network?.internetEnabled !== false &&
    ctx.network?.protectInternalNetwork !== false
      ? matchPatterns(normalized, INTERNAL_TARGET_PATTERNS)
      : null);

  if (blocked) return blocked;
  return { allowed: true };
}
