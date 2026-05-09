import { render } from "react-email";
import { AgentResponseEmail } from "../emails/AgentResponse.js";
import { APP_SETTING_KEYS, getAppSetting } from "./appSettings.js";
import { buildIssueReportUrl } from "./issueReportSigning.js";

/**
 * Approximate character budget for the email preview snippet (the line gmail
 * et al. show next to the subject in the inbox). Anything longer is silently
 * truncated by clients anyway.
 */
const PREVIEW_CHAR_BUDGET = 120;

/**
 * Filename inside `src/emails/static/` used as the avatar when an agent
 * doesn't declare its own. The file must exist; in production it's served
 * via `${PUBLIC_BASE_URL}/static/<file>` and the `pnpm build` step copies
 * it to `dist/emails/static/`.
 */
const FALLBACK_AVATAR_FILENAME = "fallback.png";

/**
 * Resolve a stored asset reference to an absolute URL the email client
 * can fetch. Email clients render images server-side, so URLs always
 * need to be absolute in production — in dev the react-email preview
 * server hosts `/static/...` directly so a relative path is fine.
 *
 * Accepts three flavours so the legacy `Agent.avatar` (just a filename
 * inside `src/emails/static/`) and the new uploads (full
 * `/static/uploads/...` URL paths) both work:
 *
 *  - `https?://…`        — used verbatim (admin pasted an external URL).
 *  - `/static/…`         — prepended with `PUBLIC_BASE_URL` in production.
 *  - bare filename       — treated as a file in `src/emails/static/` and
 *                          mapped to `${PUBLIC_BASE_URL}/static/<file>`.
 */
function resolveAssetUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const baseUrl =
    process.env.NODE_ENV === "production" ? (process.env.PUBLIC_BASE_URL ?? "") : "";
  if (value.startsWith("/static/")) return `${baseUrl}${value}`;
  return `${baseUrl}/static/${value}`;
}

/**
 * Resolve the footer logo URL for outbound emails. Returns undefined when
 * unset so the template can hide the image block entirely.
 */
async function resolveFooterLogoUrl(): Promise<string | undefined> {
  const raw = await getAppSetting(APP_SETTING_KEYS.EMAIL_FOOTER_LOGO_URL);
  if (!raw) return undefined;
  return resolveAssetUrl(raw);
}

/**
 * Strip Markdown syntax to a flat preview string. Cheap and good-enough — we
 * only need the first ~120 chars for the inbox preheader.
 */
function buildPreview(markdown: string): string {
  const flat = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= PREVIEW_CHAR_BUDGET) return flat;
  return `${flat.slice(0, PREVIEW_CHAR_BUDGET - 1).trimEnd()}\u2026`;
}

/**
 * Convert the agent's Markdown reply into a fully rendered HTML email
 * (template + optional branded footer), ready to hand to Mailgun.
 *
 * The Markdown itself is rendered by react-email's `<Markdown>` component,
 * which emits email-safe inline styles. We only strip the markdown to plain
 * text for the inbox preheader.
 *
 * Agent output is treated as trusted content (same trust model as the prior
 * plain-text pipeline). No HTML sanitization is performed.
 */
export async function renderAgentResponseHtml(args: {
  agentDisplayName: string;
  markdown: string;
  /**
   * Reference to the agent avatar — see `resolveAssetUrl` for accepted
   * formats (bare filename, `/static/...` URL path, or absolute URL).
   * When undefined, falls back to the shared `fallback.png` so the
   * email header always shows an avatar.
   */
  avatarFilename?: string;
  /**
   * EmailThread id this reply belongs to. When set together with
   * `recipientEmail`, the rendered email gains a "Report this
   * conversation" footer link the recipient can click without needing
   * a deployment account.
   */
  threadId?: string;
  recipientEmail?: string;
}): Promise<string> {
  const avatarUrl = resolveAssetUrl(args.avatarFilename ?? FALLBACK_AVATAR_FILENAME);
  const footerLogoUrl = await resolveFooterLogoUrl();
  const reportUrl =
    args.threadId && args.recipientEmail
      ? buildIssueReportUrl({ threadId: args.threadId, email: args.recipientEmail })
      : undefined;
  return render(
    AgentResponseEmail({
      agentDisplayName: args.agentDisplayName,
      avatarUrl,
      markdown: args.markdown,
      preview: buildPreview(args.markdown),
      footerLogoUrl,
      reportUrl,
    }),
  );
}
