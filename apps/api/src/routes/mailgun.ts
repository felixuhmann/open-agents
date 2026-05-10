import { Hono } from "hono";
import { getAgentByInboundLocalPart } from "../agents/service.js";
import { log } from "../log.js";
import { parseAttachments } from "../mailgun/attachments.js";
import { parseInbound } from "../mailgun/parse.js";
import { keyFingerprint, verifyMailgunSignatureDetailed } from "../mailgun/verify.js";
import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";
import { ingestInboundEmail } from "../services/inbound.js";

import type { AppVariables } from "../server/types.js";

export const MAILGUN_PREFIX = "/mailgun";

export const mailgunRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Catch-all inbound webhook. The deployment configures ONE Mailgun route
 * matching `*@<MAILGUN_DOMAIN>` that forwards here. We resolve which agent
 * the email was for by parsing the recipient address; we drop silently
 * (with a warn log) when no agent matches or the agent has email disabled.
 */
mailgunRoutes.post("/inbound", async (c) => {
  const reqId = c.get("reqId");

  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch (err) {
    log.warn("mailgun inbound: invalid form", {
      reqId,
      err: err instanceof Error ? err.message : String(err),
    });
    return c.text("bad request", 400);
  }

  const parsed = parseInbound(form);

  const signingKey = await getServiceSecret(SERVICE_KEYS.MAILGUN_SIGNING_KEY);
  if (!signingKey) {
    log.warn("mailgun inbound: signing key not configured", { reqId });
    return c.text("mailgun not configured", 503);
  }

  const verify = verifyMailgunSignatureDetailed(
    {
      timestamp: parsed.timestamp,
      token: parsed.token,
      signature: parsed.signature,
    },
    signingKey,
  );
  if (!verify.ok) {
    log.warn("mailgun inbound: signature mismatch", {
      reqId,
      reason: verify.reason,
      ts: parsed.timestamp,
      token: parsed.token,
      received: "received" in verify ? verify.received : undefined,
      expected: "expected" in verify ? verify.expected : undefined,
      ageSec: "ageSec" in verify ? verify.ageSec : undefined,
      signingKeyLen: signingKey.length,
      signingKeyFingerprint: keyFingerprint(signingKey),
    });
    return c.text("unauthorized", 401);
  }

  if (!parsed.messageId) {
    log.warn("mailgun inbound: missing Message-Id", { reqId });
    return c.text("missing message id", 400);
  }

  const localPart = extractLocalPart(parsed.to);
  if (!localPart) {
    log.warn("mailgun inbound: cannot parse recipient", {
      reqId,
      recipient: parsed.to,
    });
    return c.text("unknown recipient", 400);
  }

  const agent = await getAgentByInboundLocalPart(localPart);
  if (!agent) {
    log.warn("mailgun inbound: no agent for recipient", {
      reqId,
      localPart,
    });
    return c.text("ok", 200);
  }
  if (!agent.emailEnabled) {
    log.warn("mailgun inbound: email disabled for agent", {
      reqId,
      agentSlug: agent.slug,
    });
    return c.text("ok", 200);
  }

  const attachments = await parseAttachments(form);
  log.info("mailgun inbound: parsed", {
    reqId,
    agentSlug: agent.slug,
    from: parsed.from,
    subject: parsed.subject,
    messageId: parsed.messageId,
    bodyChars: parsed.body.length,
    attachmentCount: attachments.length,
    attachmentBytes: attachments.reduce((sum, a) => sum + a.sizeBytes, 0),
  });

  await ingestInboundEmail({
    reqId,
    agentId: agent.id,
    agentSlug: agent.slug,
    parsed,
    attachments,
  });

  return c.text("ok", 200);
});

/**
 * Pull the local-part out of an email address. Accepts both bare
 * `localPart@host` and `Display Name <localPart@host>` forms.
 */
function extractLocalPart(addr: string): string | null {
  const trimmed = addr.trim();
  const angle = /<([^>]+)>/.exec(trimmed);
  const inner = angle?.[1] ?? trimmed;
  const at = inner.indexOf("@");
  if (at <= 0) return null;
  return inner.slice(0, at).toLowerCase();
}
