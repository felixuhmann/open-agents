import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Markdown,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";
import * as React from "react";

export type AgentResponseEmailProps = {
  /** Agent display name shown in the header. */
  agentDisplayName: string;
  /**
   * Absolute URL of the agent avatar shown in the email header at 56×56 px.
   * Always required — the render service resolves either the agent's
   * configured avatar or the shared `fallback.png` to a URL via
   * `${PUBLIC_BASE_URL}/static/...` (or just `/static/...` in dev).
   */
  avatarUrl: string;
  /**
   * Agent reply, raw Markdown. Rendered with react-email's `<Markdown>`
   * component which emits email-safe inline styles for headings/lists/code/
   * links. Treated as trusted content (same trust model as the previous
   * plain-text pipeline).
   */
  markdown: string;
  /** Short plain-text snippet shown in inbox preview / Gmail preheader. */
  preview: string;
  /**
   * Optional absolute URL of a logo image rendered in the email footer.
   * Pulled from the `email_footer_logo_url` deployment-level setting.
   * When unset, the footer omits the image and only shows the
   * "reply to continue" hint.
   */
  footerLogoUrl?: string;
  /**
   * Optional absolute URL of the "Report this conversation" link surfaced
   * in the email footer. When set, recipients can flag a misbehaving
   * agent reply without needing a deployment account; the link carries an
   * HMAC-signed token bound to the EmailThread + recipient address.
   */
  reportUrl?: string;
};

const markdownStyles = {
  p: { fontSize: "15px", lineHeight: "1.6", color: "#1f2937", margin: "0 0 12px 0" },
  h1: { fontSize: "20px", color: "#111827", margin: "16px 0 8px 0" },
  h2: { fontSize: "18px", color: "#111827", margin: "16px 0 8px 0" },
  h3: { fontSize: "16px", color: "#111827", margin: "16px 0 8px 0" },
  ul: { paddingLeft: "20px", margin: "0 0 12px 0" },
  ol: { paddingLeft: "20px", margin: "0 0 12px 0" },
  li: { fontSize: "15px", lineHeight: "1.6", color: "#1f2937", margin: "4px 0" },
  link: { color: "#2563eb", textDecoration: "underline" },
  codeInline: {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: "13px",
    backgroundColor: "#f3f4f6",
    padding: "2px 4px",
    borderRadius: "4px",
  },
  codeBlock: {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: "13px",
    backgroundColor: "#f3f4f6",
    color: "#1f2937",
    padding: "12px",
    borderRadius: "6px",
    overflowX: "auto" as const,
    margin: "0 0 12px 0",
  },
  hr: { borderColor: "#e5e9f0", margin: "16px 0" },
  blockQuote: {
    borderLeft: "3px solid #e5e9f0",
    paddingLeft: "12px",
    color: "#4b5563",
    margin: "0 0 12px 0",
  },
};

export function AgentResponseEmail({
  agentDisplayName,
  avatarUrl,
  markdown,
  preview,
  footerLogoUrl,
  reportUrl,
}: AgentResponseEmailProps): React.ReactElement {
  return (
    <Html lang="en">
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                ink: "#111827",
                muted: "#6b7280",
                line: "#e5e9f0",
              },
            },
          },
        }}
      >
        <Head />
        <Body className="m-0 bg-[#f6f8fb] p-0 font-sans">
          <Preview>{preview}</Preview>
          <Container className="my-6 max-w-[600px] rounded-lg border border-solid border-line bg-white p-8">
            <Section className="mb-2">
              <Row>
                <Column className="w-[72px] align-middle">
                  <Img
                    src={avatarUrl}
                    alt={agentDisplayName}
                    width="56"
                    height="56"
                    className="block rounded-full"
                  />
                </Column>
                <Column className="align-middle">
                  <Text className="m-0 text-xs font-semibold uppercase tracking-wider text-muted">
                    Reply from
                  </Text>
                  <Text className="m-0 mt-1 text-xl font-bold text-ink">
                    {agentDisplayName}
                  </Text>
                </Column>
              </Row>
            </Section>
            <Hr className="my-5 border-solid border-line" />
            <Section>
              <Markdown markdownCustomStyles={markdownStyles}>{markdown}</Markdown>
            </Section>
            <Hr className="my-5 border-solid border-line" />
            <Section className="mt-6">
              {footerLogoUrl ? (
                <Img
                  src={footerLogoUrl}
                  alt=""
                  width="105"
                  height="50"
                  className="m-0 block"
                />
              ) : null}
              <Text className="m-0 mt-3 text-xs text-muted">
                Reply to this email to continue the conversation.
              </Text>
              {reportUrl ? (
                <Text className="m-0 mt-2 text-xs text-muted">
                  Did the agent behave incorrectly?{" "}
                  <a
                    href={reportUrl}
                    style={{ color: "#2563eb", textDecoration: "underline" }}
                  >
                    Report this conversation
                  </a>
                  .
                </Text>
              ) : null}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

AgentResponseEmail.PreviewProps = {
  agentDisplayName: "Acme Helper",
  avatarUrl: "/static/fallback.png",
  preview: "Hi! Here's the summary you asked for plus a CSV of the underlying rows.",
  markdown: `Hi! Here is the summary you asked for, plus a CSV of the underlying rows.

## Highlights

- **47** new entries since last week
- **3** flagged for review
- Average turnaround dropped from 4.2 to 3.8 days

### Quick example

\`\`\`ts
const total = items.reduce((acc, item) => acc + item.amount, 0);
\`\`\`

> Tip: reply to this email to keep the conversation going — I'll resume
> the same session and carry forward the context.
`,
} satisfies AgentResponseEmailProps;

export default AgentResponseEmail;
