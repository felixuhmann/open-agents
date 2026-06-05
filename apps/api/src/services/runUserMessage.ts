/**
 * User turn text passed to the agent backend, including any attachment-return
 * hint the surface needs.
 */
export function buildRunUserMessage(userText: string): string {
  return [
    userText,
    "",
    "To return downloadable files to the user, call the attach_run_file tool with the sandbox file path. Do not use sandbox: links in your reply — attachments are the download mechanism.",
  ].join("\n");
}
