/** Max characters returned to the model from a single tool invocation. */
export const MAX_TOOL_OUTPUT_CHARS = 20_000;

/** Max characters read from a single file via the read tool. */
export const MAX_READ_FILE_CHARS = 80_000;

/** Default wall-clock limit for bash (seconds). */
export const DEFAULT_BASH_TIMEOUT_SECONDS = 60;

/** Hard cap on bash timeout (seconds). */
export const MAX_BASH_TIMEOUT_SECONDS = 600;

/** Default timeout for grep and similar short shell helpers (seconds). */
export const DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS = 30;

/** Minimum interval between streamed `tool.output` RunEvents per command. */
export const TOOL_OUTPUT_EMIT_INTERVAL_MS = 250;

/** Flush a pending stream buffer when it reaches this size (chars). */
export const TOOL_OUTPUT_EMIT_MIN_CHARS = 512;

export function truncateText(
  text: string,
  maxChars: number,
  label = "output",
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const omitted = text.length - maxChars;
  return {
    text: `${text.slice(0, maxChars)}\n\n[${label}: truncated ${omitted} chars; showing first ${maxChars} of ${text.length}]`,
    truncated: true,
  };
}
