# Email static assets

Drop email image assets (PNG/JPG only — no SVG/WEBP, those are unreliable in
many email clients) into this folder. They are served two ways:

- During `pnpm --filter @open-agents/api email` (preview), the `react-email`
  dev server serves files at `http://localhost:3001/static/<file>`.
- In production, the Hono app serves them at
  `${PUBLIC_BASE_URL}/static/<file>` via [`src/routes/static.ts`](../../routes/static.ts).
  The `pnpm build` step copies this folder to `dist/emails/static/` so
  `node apps/api/dist/index.js` can find them.

## Files expected here

- `fallback.png` — default agent avatar shown in the email header when an
  `Agent` row doesn't declare its own `avatar`. Square PNG.
- Any per-agent avatar PNG/JPG referenced from `Agent.avatar`.
- Optionally: a brand image used by the email footer. Drop the file here
  and point the **email footer logo URL** under
  `/settings/general` at `/static/<file>` to enable it.

## Agent avatars

Each agent can pin a profile picture that's rendered in the email header
next to the display name. The convention:

- Drop a square PNG/JPG into this folder (~256×256 px works well — it's
  rendered at 56×56).
- From `/agents/<slug>/edit` in the SPA, set the **avatar** field to the
  filename (e.g. `acme-helper.png`). The `Agent.avatar` column stores
  the filename verbatim.
- Agents that leave `avatar` empty fall back to `fallback.png`, so every
  agent's email always shows an avatar.

The render service ([`src/services/renderEmail.ts`](../../services/renderEmail.ts))
resolves the filename to a fully-qualified URL (`${PUBLIC_BASE_URL}/static/<file>`
in production, `/static/<file>` in dev) before handing it to
[`AgentResponse.tsx`](../AgentResponse.tsx).

## Email footer logo

The footer logo is **not** hardcoded into the template anymore. Set the
`email_footer_logo_url` value under **Settings → General** in the SPA:

- Absolute URLs (`https://example.com/brand.png`) are passed through as-is.
- Relative `/static/<file>` URLs are resolved against `PUBLIC_BASE_URL` at
  send time, so you can drop a logo into this folder and reference it as
  `/static/<file>`.
- When the setting is empty, the footer omits the image entirely.
