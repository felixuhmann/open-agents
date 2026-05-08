# Email static assets

This folder contains the **bundled** assets shipped with the repo (e.g.
the fallback agent avatar). Admin-uploaded branding (per-agent profile
pictures and the deployment-wide footer logo) lives elsewhere — see
[`apps/api/data/uploads/`](../../../data/uploads/). Both directories are
served under the same `/static/...` URL prefix; the folder layout just
keeps source-controlled defaults separate from runtime uploads.

How files in this folder are served:

- During `pnpm --filter @open-agents/api email` (preview), the `react-email`
  dev server serves files at `http://localhost:3001/static/<file>`.
- In production, the Hono app serves them at
  `${PUBLIC_BASE_URL}/static/<file>` via [`src/routes/static.ts`](../../routes/static.ts).
  The `pnpm build` step copies this folder to `dist/emails/static/` so
  `node apps/api/dist/index.js` can find them.

Stick to PNG/JPG for files in this folder — SVG/WebP are unreliable in
many email clients. Admin uploads accept the broader set (browser
preview is fine, the templates only embed PNG-flavoured assets in
practice).

## Files expected here

- `fallback.png` — default agent avatar shown in the email header when
  an `Agent` row doesn't declare its own `avatar`. Square PNG.

Per-agent profile pictures and the footer logo are uploaded through the
SPA and stored under `apps/api/data/uploads/`; nothing per-customer
should land in `src/emails/static/` directly.

## Agent profile pictures

Each agent can pin a profile picture that's rendered in the email header
next to the display name (also shown in the SPA agent list, detail
page, and chat header). Set it from `/agents/<slug>/edit` → **Profile
picture** → **Upload**. The file is stored under
`apps/api/data/uploads/avatars/` and `Agent.avatar` records its public
URL (e.g. `/static/uploads/avatars/<slug>-<random>.png`). Agents that
leave the field empty fall back to `fallback.png`.

For backwards compatibility, `Agent.avatar` also accepts a bare filename
inside this folder or an absolute `https://...` URL — the render
service ([`src/services/renderEmail.ts`](../../services/renderEmail.ts))
resolves all three flavours to an absolute URL before handing it to
[`AgentResponse.tsx`](../AgentResponse.tsx).

## Email footer logo

Set it from **Settings → General → Email footer logo** in the SPA:

- **Upload image** stores the file under `apps/api/data/uploads/footer/`
  and writes the resulting `/static/uploads/footer/<file>` URL to the
  `email_footer_logo_url` setting.
- The URL field still accepts an absolute `https://...` URL or any
  `/static/...` path if you'd rather host the image elsewhere.
- When the setting is empty, the footer omits the image entirely.
