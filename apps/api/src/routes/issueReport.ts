import { Hono } from "hono";
import { html } from "hono/html";
import { z } from "zod";
import { prisma } from "../db.js";
import { log } from "../log.js";
import type { AppVariables } from "../server/types.js";
import { createEmailIssue } from "../services/issues.js";
import { verifyIssueReportToken } from "../services/issueReportSigning.js";

/**
 * Public, unauthenticated issue-report flow used by email recipients. The
 * outbound email template embeds a signed token bound to the EmailThread
 * and recipient address; this router verifies the token, lets the user
 * type a description, and creates the Issue row.
 *
 * No cookie session is required — the signature is the credential.
 */

export const ISSUE_REPORT_PREFIX = "/issues";

export const issueReportRoutes = new Hono<{ Variables: AppVariables }>();

type HtmlFragment = ReturnType<typeof html>;

function renderPage(args: { title: string; body: HtmlFragment }): HtmlFragment {
  return html`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${args.title}</title>
        <style>
          :root {
            color-scheme: light dark;
          }
          body {
            font-family:
              ui-sans-serif,
              system-ui,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              Roboto,
              "Helvetica Neue",
              Arial,
              sans-serif;
            background: #f6f8fb;
            color: #111827;
            margin: 0;
            padding: 32px 16px;
            display: flex;
            justify-content: center;
            min-height: 100vh;
            box-sizing: border-box;
          }
          .card {
            width: 100%;
            max-width: 560px;
            background: #ffffff;
            border: 1px solid #e5e9f0;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          }
          h1 {
            font-size: 20px;
            margin: 0 0 4px 0;
          }
          .muted {
            color: #6b7280;
            font-size: 13px;
            margin: 0 0 16px 0;
          }
          label {
            display: block;
            font-size: 13px;
            font-weight: 600;
            margin: 12px 0 6px 0;
          }
          input,
          textarea {
            font: inherit;
            width: 100%;
            box-sizing: border-box;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 10px 12px;
            background: #ffffff;
            color: inherit;
          }
          textarea {
            min-height: 140px;
            resize: vertical;
          }
          input:disabled {
            background: #f3f4f6;
            color: #6b7280;
          }
          button {
            margin-top: 16px;
            background: #111827;
            color: #ffffff;
            border: 0;
            border-radius: 6px;
            padding: 10px 16px;
            font-weight: 600;
            cursor: pointer;
          }
          button:hover {
            background: #1f2937;
          }
          .alert {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #991b1b;
            border-radius: 6px;
            padding: 12px 14px;
            font-size: 13px;
            margin-bottom: 12px;
          }
          .ok {
            background: #ecfdf5;
            border-color: #a7f3d0;
            color: #065f46;
          }
          footer {
            margin-top: 16px;
            font-size: 12px;
            color: #9ca3af;
          }
        </style>
      </head>
      <body>
        <div class="card">${args.body}</div>
      </body>
    </html>`;
}

function renderInvalid(): HtmlFragment {
  return renderPage({
    title: "Report not available",
    body: html`<h1>Report not available</h1>
      <div class="alert">
        This report link is invalid or has expired. If the agent's behaviour is still an
        issue, reply to the email thread and a member of the team will follow up.
      </div>`,
  });
}

issueReportRoutes.get("/report", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.html(renderInvalid(), 400);
  const verified = verifyIssueReportToken(token);
  if (!verified) return c.html(renderInvalid(), 400);

  const thread = await prisma.emailThread.findUnique({
    where: { id: verified.threadId },
    include: {
      agent: { select: { displayName: true } },
    },
  });
  if (!thread) return c.html(renderInvalid(), 404);

  const body = html`<h1>Report a problem with ${thread.agent.displayName}</h1>
    <p class="muted">Thread: <strong>${thread.subject}</strong></p>
    <form method="POST" action="/issues/report">
      <input type="hidden" name="token" value="${token}" />
      <label>Your email</label>
      <input type="email" value="${verified.email}" disabled />
      <label for="description">What went wrong?</label>
      <textarea
        id="description"
        name="description"
        placeholder="Describe what the agent did wrong, what you expected instead, and any other context that would help us fix it."
        required
        minlength="1"
        maxlength="4000"
      ></textarea>
      <button type="submit">Submit report</button>
      <footer>
        Your message and the full conversation will be visible to the deployment admins so
        they can investigate.
      </footer>
    </form>`;
  return c.html(renderPage({ title: "Report a problem", body }));
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
    return c.html(renderInvalid(), 400);
  }
  const parsed = FormSchema.safeParse({
    token: form.token,
    description: form.description,
  });
  if (!parsed.success) {
    return c.html(renderInvalid(), 400);
  }
  const verified = verifyIssueReportToken(parsed.data.token);
  if (!verified) {
    return c.html(renderInvalid(), 400);
  }
  try {
    const created = await createEmailIssue({
      threadId: verified.threadId,
      reporterEmail: verified.email,
      description: parsed.data.description,
    });
    log.info("issue-report: filed", {
      reqId,
      issueId: created.id,
      threadId: verified.threadId,
    });
  } catch (err) {
    log.warn("issue-report: failed", {
      reqId,
      err: err instanceof Error ? err.message : String(err),
    });
    return c.html(renderInvalid(), 400);
  }
  const body = html`<h1>Thanks for reporting</h1>
    <div class="alert ok">
      Your report has been filed. The team can now review the conversation and follow up.
    </div>
    <p class="muted">You can close this tab.</p>`;
  return c.html(renderPage({ title: "Thanks", body }));
});
