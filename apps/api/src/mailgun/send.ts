import FormData from "form-data";
import Mailgun from "mailgun.js";
import type { MailgunMessageData } from "mailgun.js/definitions";
import { config } from "../config.js";
import { log } from "../log.js";
import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";

type MailgunClient = ReturnType<Mailgun["client"]>;

export type OutboundAttachment = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type SendEmailInput = {
  /**
   * Full `From:` header (display name + address). When omitted falls back to
   * the deployment's INBOUND_FROM service secret. Callers should pass an
   * agent-specific value so the address matches the catch-all Mailgun route
   * and user replies thread back to the same agent.
   */
  from?: string;
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: OutboundAttachment[];
};

export type SendEmailResult = {
  id: string;
  message: string;
};

function formatMessageId(id: string): string {
  return id.startsWith("<") ? id : `<${id}>`;
}

let cachedClient: MailgunClient | null = null;
let cachedKey: string | null = null;

async function getMailgunClient(): Promise<{ client: MailgunClient; domain: string }> {
  const apiKey = await getServiceSecret(SERVICE_KEYS.MAILGUN_API_KEY);
  const domain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  if (!apiKey || !domain) {
    throw new Error("Mailgun is not configured (missing api key or domain).");
  }
  if (cachedClient && cachedKey === apiKey) {
    return { client: cachedClient, domain };
  }
  const mg = new Mailgun(FormData);
  cachedClient = mg.client({
    username: "api",
    key: apiKey,
    url: config.MAILGUN_BASE_URL,
  });
  cachedKey = apiKey;
  return { client: cachedClient, domain };
}

export function resetMailgunClient(): void {
  cachedClient = null;
  cachedKey = null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const attachments = input.attachments ?? [];
  const fallbackFrom =
    (await getServiceSecret(SERVICE_KEYS.INBOUND_FROM)) ?? "agent@example.com";
  const from = input.from ?? fallbackFrom;

  const refs = (input.references ?? []).map(formatMessageId);
  if (input.inReplyTo) {
    const parent = formatMessageId(input.inReplyTo);
    if (!refs.includes(parent)) refs.push(parent);
  }

  const { client, domain } = await getMailgunClient();
  log.info("mailgun send: start", {
    domain,
    from,
    to: input.to,
    subject: input.subject,
    htmlChars: input.html.length,
    inReplyTo: input.inReplyTo ?? null,
    referencesCount: refs.length,
    attachmentCount: attachments.length,
    attachmentNames: attachments.map((a) => a.filename),
  });

  const data: MailgunMessageData = {
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  };
  if (input.inReplyTo) {
    data["h:In-Reply-To"] = formatMessageId(input.inReplyTo);
  }
  if (refs.length > 0) {
    data["h:References"] = refs.join(" ");
  }
  if (attachments.length > 0) {
    data.attachment = attachments.map((att) => ({
      filename: att.filename,
      data: Buffer.from(att.bytes),
      contentType: att.contentType || "application/octet-stream",
    }));
  }

  const start = Date.now();
  try {
    const result = await client.messages.create(domain, data);
    const durationMs = Date.now() - start;
    if (!result.id) {
      log.error("mailgun send: missing id in response", {
        durationMs,
        status: result.status,
        details: result.details,
        to: input.to,
      });
      throw new Error(
        `Mailgun send failed: ${result.status} ${result.details ?? "no id"}`,
      );
    }
    log.info("mailgun send: ok", {
      id: result.id,
      to: input.to,
      status: result.status,
      durationMs,
      mailgunMessage: result.message,
      attachmentCount: attachments.length,
    });
    return { id: result.id, message: result.message ?? "" };
  } catch (err) {
    const durationMs = Date.now() - start;
    log.error("mailgun send: failed", {
      durationMs,
      to: input.to,
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    throw err;
  }
}
