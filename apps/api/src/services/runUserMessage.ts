/**
 * User turn text passed to the agent backend, including any attachment-return
 * hint the surface needs.
 */
export function buildRunUserMessage(userText: string): string {
  return [
    userText,
    "",
    "To return downloadable files in chat or email, call the attach_run_file tool with the sandbox file path.",
  ].join("\n");
}
