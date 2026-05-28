/**
 * Lightweight guardrails for sandbox shell commands. This is not a full
 * sandbox escape hatch — Daytona still owns network and process isolation.
 * We block a small set of obviously destructive patterns before execution.
 */

export type ShellPolicyVerdict = { allowed: true } | { allowed: false; reason: string };

const BLOCKED_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
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

export function checkShellCommand(command: string): ShellPolicyVerdict {
  const normalized = command.trim();
  if (!normalized) {
    return { allowed: false, reason: "empty command" };
  }
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason };
    }
  }
  return { allowed: true };
}
