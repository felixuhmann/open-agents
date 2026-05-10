/**
 * Normalized payload extracted from a Mailgun inbound webhook form submission.
 *
 * Mailgun's "Store and notify" / "Forward" inbound routes POST multipart form
 * data with keys like `sender`, `recipient`, `subject`, `stripped-text`,
 * `body-plain`, `Message-Id`, `In-Reply-To`, `References`, plus `timestamp`,
 * `token`, and `signature` for HMAC verification.
 */
export type InboundEmail = {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  body: string;
  timestamp: string;
  token: string;
  signature: string;
};

function firstString(form: Record<string, unknown>, key: string): string {
  const v = form[key];
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : "";
  return typeof v === "string" ? v : "";
}

/**
 * Normalize a Message-Id/In-Reply-To value: strip surrounding angle brackets
 * and surrounding whitespace. Empty strings become `null`.
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^<|>$/g, "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parseReferences(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((r) => normalizeMessageId(r))
    .filter((r): r is string => r !== null);
}

export function parseInbound(form: Record<string, unknown>): InboundEmail {
  const messageIdRaw = firstString(form, "Message-Id") || firstString(form, "message-id");
  const inReplyToRaw =
    firstString(form, "In-Reply-To") || firstString(form, "in-reply-to");
  const referencesRaw =
    firstString(form, "References") || firstString(form, "references");
  const strippedText = firstString(form, "stripped-text");
  const bodyPlain = firstString(form, "body-plain");

  return {
    from: firstString(form, "sender") || firstString(form, "from"),
    to: firstString(form, "recipient") || firstString(form, "To"),
    subject:
      firstString(form, "subject") || firstString(form, "Subject") || "(no subject)",
    messageId: normalizeMessageId(messageIdRaw) ?? "",
    inReplyTo: normalizeMessageId(inReplyToRaw),
    references: parseReferences(referencesRaw),
    body: strippedText || bodyPlain || "",
    timestamp: firstString(form, "timestamp"),
    token: firstString(form, "token"),
    signature: firstString(form, "signature"),
  };
}
