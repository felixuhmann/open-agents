import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { log } from "../log.js";

/**
 * Local filesystem root for admin-uploaded branding (agent avatars, the
 * deployment-wide email footer logo). Lives outside of source control so
 * a `pnpm install` doesn't blow it away. `STATIC_UPLOADS_DIR` overrides
 * the default — handy in tests or when mounting a persistent volume in
 * production.
 *
 * Keep this as a CWD-relative path: `serveStatic` (used by the
 * `/static/uploads/*` route) does not accept absolute roots.
 */
export const UPLOADS_DIR = process.env.STATIC_UPLOADS_DIR ?? "data/uploads";

/**
 * URL prefix the SPA + the email templates use to fetch uploaded assets.
 * Must stay in sync with the `/uploads/*` mount inside the `/static`
 * router (see `routes/static.ts`).
 */
export const UPLOADS_URL_PREFIX = "/static/uploads";

/**
 * Hard cap per branding image. 5 MB is plenty for an avatar/logo and
 * keeps Postgres / Mailgun out of trouble if someone tries to inline a
 * raw camera shot.
 */
export const MAX_BRANDING_BYTES = 5 * 1024 * 1024;

/**
 * Image content types we accept. Anything else is rejected at the route
 * boundary — we don't want admins uploading random binaries into a
 * statically-served directory.
 */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

export type BrandingKind = "avatars" | "footer";

export type SavedBranding = {
  /** Bare filename inside `UPLOADS_DIR/<kind>/`. */
  filename: string;
  /** URL path the SPA + email renderer use to fetch the asset. */
  url: string;
  contentType: string;
  sizeBytes: number;
};

function safeExtension(file: { name?: string; type?: string }): string {
  if (file.type) {
    const fromType = EXT_BY_TYPE[file.type];
    if (fromType) return fromType;
  }
  const fromName = file.name ? extname(file.name).toLowerCase() : "";
  if (fromName && /^\.[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  return ".bin";
}

/**
 * Persist a branding image to disk and return the URL the rest of the
 * stack should use to reference it. The `prefix` is included in the
 * generated filename so admins can identify ownership in the data
 * directory at a glance (e.g. `support-bot-…png`).
 */
export async function saveBrandingImage(args: {
  kind: BrandingKind;
  prefix: string;
  bytes: Buffer;
  contentType: string;
  originalName: string;
}): Promise<SavedBranding> {
  if (args.bytes.byteLength === 0) {
    throw new Error("empty file");
  }
  if (args.bytes.byteLength > MAX_BRANDING_BYTES) {
    throw new Error(`file too large (>${MAX_BRANDING_BYTES} bytes)`);
  }
  const lowerType = args.contentType.toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(lowerType)) {
    throw new Error(`unsupported image type: ${args.contentType}`);
  }

  const dir = join(UPLOADS_DIR, args.kind);
  await mkdir(dir, { recursive: true });

  const ext = safeExtension({ name: args.originalName, type: lowerType });
  const safePrefix = args.prefix.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "img";
  const filename = `${safePrefix}-${randomBytes(8).toString("hex")}${ext}`;
  const path = join(dir, filename);

  await writeFile(path, args.bytes);

  log.info("uploads: saved branding", {
    kind: args.kind,
    filename,
    sizeBytes: args.bytes.byteLength,
  });

  return {
    filename,
    url: `${UPLOADS_URL_PREFIX}/${args.kind}/${filename}`,
    contentType: lowerType,
    sizeBytes: args.bytes.byteLength,
  };
}

/**
 * Best-effort deletion of a previously-saved branding asset. Accepts the
 * URL we stored in the DB (or just the bare filename) and silently
 * ignores files that are already gone.
 *
 * Refuses to touch anything outside of `UPLOADS_DIR/<kind>/`, so a stray
 * `../` or absolute path stored in the DB can't escape the directory.
 */
export async function deleteBrandingAsset(args: {
  kind: BrandingKind;
  urlOrFilename: string;
}): Promise<void> {
  const filename = extractFilename(args.urlOrFilename, args.kind);
  if (!filename) return;
  const path = join(UPLOADS_DIR, args.kind, filename);
  try {
    await unlink(path);
    log.info("uploads: deleted branding", { kind: args.kind, filename });
  } catch (err) {
    log.warn("uploads: delete failed", {
      kind: args.kind,
      filename,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function extractFilename(value: string, kind: BrandingKind): string | null {
  const expectedPrefix = `${UPLOADS_URL_PREFIX}/${kind}/`;
  let filename = value;
  if (value.startsWith(expectedPrefix)) {
    filename = value.slice(expectedPrefix.length);
  } else if (value.includes("/") || value.includes("\\")) {
    return null;
  }
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === ".."
  ) {
    return null;
  }
  return filename;
}
