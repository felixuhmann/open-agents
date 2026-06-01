import type { AgentBackend } from "../agent-backend/types.js";
import { config } from "../config.js";
import { signRunUploadUrl } from "./uploadSigning.js";

/**
 * User turn text passed to the agent backend, including any attachment-return
 * hint the surface needs.
 */
export function buildRunUserMessage(
  backend: AgentBackend,
  runId: string,
  userText: string,
): string {
  if (backend.runtime === "daytona") {
    return [
      userText,
      "",
      "To return downloadable files in chat or email, call the attach_run_file tool with the sandbox file path.",
      "Do not curl REPLY_ATTACHMENT_UPLOAD_URL from bash — the sandbox cannot reach the orchestrator URL.",
    ].join("\n");
  }

  const uploadSig = signRunUploadUrl(runId);
  const uploadUrl = `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/runs/${runId}/attachments?sig=${uploadSig}`;
  return `${userText}\n\nREPLY_ATTACHMENT_UPLOAD_URL: ${uploadUrl}`;
}
