import { render } from "react-email";
import { AgentResponseEmail } from "../emails/AgentResponse.js";
import { APP_SETTING_KEYS, getAppSetting } from "./appSettings.js";

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
 * Build an absolute URL for an asset in `src/emails/static/`. In dev the
 * react-email preview server hosts `/static/...` directly, in production
 * we need a fully-qualified URL because email clients fetch images
 * server-side.
 */
function resolveStaticUrl(filename: string): string {
  const baseUrl =
    process.env.NODE_ENV === "production" ? (process.env.PUBLIC_BASE_URL ?? "") : "";
  return `${baseUrl}/static/${filename}`;
}

/**
 * Resolve the footer logo URL for outbound emails.
 *
 * - If the admin set `email_footer_logo_url` in **General settings** to an
 *   absolute URL (`https://...`), use it verbatim.
 * - If the value is a `/static/<file>` reference, prepend the public base
 *   URL in production so email clients (which fetch images server-side)
 *   get an absolute URL.
 * - When unset, return undefined and the template hides the image block.
 */
async function resolveFooterLogoUrl(): Promise<string | undefined> {
  const raw = await getAppSetting(APP_SETTING_KEYS.EMAIL_FOOTER_LOGO_URL);
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/static/")) {
    const baseUrl =
      process.env.NODE_ENV === "production" ? (process.env.PUBLIC_BASE_URL ?? "") : "";
    return `${baseUrl}${raw}`;
  }
  return raw;
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
   * Filename of the agent avatar inside `src/emails/static/`. When
   * undefined, falls back to the shared `fallback.png` so the email
   * header always shows an avatar.
   */
  avatarFilename?: string;
}): Promise<string> {
  const avatarUrl = resolveStaticUrl(args.avatarFilename ?? FALLBACK_AVATAR_FILENAME);
  const footerLogoUrl = await resolveFooterLogoUrl();
  return render(
    AgentResponseEmail({
      agentDisplayName: args.agentDisplayName,
      avatarUrl,
      markdown: args.markdown,
      preview: buildPreview(args.markdown),
      footerLogoUrl,
    }),
  );
}
