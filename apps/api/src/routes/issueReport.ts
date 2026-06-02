import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.js";
import { log } from "../log.js";
import type { AppVariables } from "../server/types.js";
import { createEmailIssue } from "../services/issues.js";
import { verifyIssueReportToken } from "../services/issueReportSigning.js";

/**
 * Legacy `/issues/report` paths on the API origin. When `WEB_BASE_URL` differs
 * from `PUBLIC_BASE_URL` (typical local dev: API :3000, Vite :5173), email
 * links may still target the API host — these handlers forward to the SPA.
 *
 * When both URLs share the same origin (production), this router is not
 * mounted; `/issues/report` is served by the SPA catch-all instead.
 */

export const ISSUE_REPORT_PREFIX = "/issues";

export const issueReportRoutes = new Hono<{ Variables: AppVariables }>();

function spaReportUrl(search: string): string {
  const base = config.WEB_BASE_URL.replace(/\/$/, "");
  return `${base}/issues/report${search}`;
}

issueReportRoutes.get("/report", (c) => {
  const url = new URL(c.req.url);
  return c.redirect(spaReportUrl(url.search), 302);
});

const FormSchema = z.object({
  token: z.string().min(1),
  description: z.string().min(1).max(4000),
});

issueReportRoutes.post("/report", async (c) => {
  const reqId = c.get("reqId");
  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody({ all: false });
  } catch {
    return c.redirect(spaReportUrl(""), 302);
  }
  const parsed = FormSchema.safeParse({
    token: form.token,
    description: form.description,
  });
  if (!parsed.success) {
    return c.redirect(spaReportUrl(""), 302);
  }
  const verified = verifyIssueReportToken(parsed.data.token);
  if (!verified) {
    return c.redirect(spaReportUrl(""), 302);
  }
  try {
    const created = await createEmailIssue({
      threadId: verified.threadId,
      reporterEmail: verified.email,
      description: parsed.data.description,
    });
    log.info("issue-report: filed (legacy POST)", {
      reqId,
      issueId: created.id,
      threadId: verified.threadId,
    });
  } catch (err) {
    log.warn("issue-report: legacy POST failed", {
      reqId,
      err: err instanceof Error ? err.message : String(err),
    });
    return c.redirect(spaReportUrl(""), 302);
  }
  return c.redirect(spaReportUrl("?success=1"), 303);
});

export function shouldMountLegacyIssueReportRoutes(): boolean {
  return (
    config.WEB_BASE_URL.replace(/\/$/, "") !== config.PUBLIC_BASE_URL.replace(/\/$/, "")
  );
}
