import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import yazl from "yazl";
import { config } from "../config.js";
import { log } from "../log.js";
import { API_PACKAGE_ROOT } from "./skillBundlePaths.js";

/**
 * The control-plane agent skill is the folder
 * `docs/skills/open-agents-control-plane/` (SKILL.md + references). It is the
 * source of truth humans edit; this service compiles it into a downloadable
 * `.skill` bundle (a zip) at runtime so the download can never drift from the
 * committed docs the way a checked-in artifact would.
 *
 * `docs/` is stripped from the production image (`.dockerignore`), so the
 * `apps/api` build copies the folder into `dist/skills/<name>/`. We look there
 * first (prod) and fall back to the repo `docs/` tree (dev / `tsx`).
 */
export const CONTROL_PLANE_SKILL_NAME = "open-agents-control-plane";
export const CONTROL_PLANE_SKILL_FILENAME = `${CONTROL_PLANE_SKILL_NAME}.skill`;

function candidateSkillDirs(): string[] {
  return [
    join(API_PACKAGE_ROOT, "dist", "skills", CONTROL_PLANE_SKILL_NAME),
    join(API_PACKAGE_ROOT, "..", "..", "docs", "skills", CONTROL_PLANE_SKILL_NAME),
  ];
}

async function resolveSkillDir(): Promise<string | null> {
  for (const dir of candidateSkillDirs()) {
    try {
      await access(dir);
      return dir;
    } catch {
      // try next candidate
    }
  }
  return null;
}

type SkillFile = { rel: string; bytes: Buffer };

async function collectFiles(dir: string, base: string): Promise<SkillFile[]> {
  const out: SkillFile[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  // Sort for a deterministic bundle (stable ETag across restarts).
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(abs, base)));
    } else if (entry.isFile()) {
      out.push({
        rel: relative(base, abs).split(sep).join("/"),
        bytes: await readFile(abs),
      });
    }
  }
  return out;
}

function zipFiles(files: SkillFile[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const file of files) {
      // Nest under the skill name so the bundle unzips into
      // `<name>/SKILL.md` — the shape the Skills Library and sandbox
      // materialization expect. Fixed mtime keeps the bytes reproducible.
      zip.addBuffer(file.bytes, `${CONTROL_PLANE_SKILL_NAME}/${file.rel}`, {
        mtime: new Date(0),
        mode: 0o644,
      });
    }
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
    zip.end();
  });
}

export type ControlPlaneSkillBundle = { bytes: Buffer; etag: string };

async function build(): Promise<ControlPlaneSkillBundle | null> {
  const dir = await resolveSkillDir();
  if (!dir) {
    log.warn("control-plane skill: source folder not found", {
      candidates: candidateSkillDirs(),
    });
    return null;
  }
  const files = await collectFiles(dir, dir);
  if (!files.some((f) => f.rel === "SKILL.md")) {
    log.warn("control-plane skill: SKILL.md missing", { dir });
    return null;
  }
  const bytes = await zipFiles(files);
  // Hash the file tree (not the zip bytes) so the ETag is stable regardless of
  // zip encoding details.
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.rel);
    hash.update("\0");
    hash.update(file.bytes);
  }
  const etag = `"${hash.digest("hex")}"`;
  log.info("control-plane skill: built bundle", {
    dir,
    files: files.length,
    bytes: bytes.byteLength,
  });
  return { bytes, etag };
}

let cached: Promise<ControlPlaneSkillBundle | null> | null = null;

/**
 * Build (and memoize) the control-plane `.skill` bundle. The source folder is
 * static within a deployment, so the bundle is built once per process.
 */
export function getControlPlaneSkillBundle(): Promise<ControlPlaneSkillBundle | null> {
  cached ??= build().catch((err) => {
    cached = null; // allow a retry on the next request
    throw err;
  });
  return cached;
}

/** Extract `name`/`description` from the SKILL.md YAML frontmatter, if present. */
async function readSkillMeta(): Promise<{ name?: string; description?: string }> {
  const dir = await resolveSkillDir();
  if (!dir) return {};
  let text: string;
  try {
    text = await readFile(join(dir, "SKILL.md"), "utf8");
  } catch {
    return {};
  }
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!match) return {};
  const meta: { name?: string; description?: string } = {};
  const frontmatter = match[1] ?? "";
  for (const line of frontmatter.split("\n")) {
    const kv = /^(name|description):\s*(.+)$/.exec(line);
    if (kv?.[1] && kv[2]) {
      meta[kv[1] as "name" | "description"] = kv[2].trim();
    }
  }
  return meta;
}

export type ControlPlaneSkillInfo = {
  name: string;
  description?: string;
  filename: string;
  downloadUrl: string;
  installPath: string;
  install: string;
};

/**
 * Public metadata + download link for the control-plane skill. Backs both the
 * REST info route and the `skill_download_link` MCP tool — the payload is kept
 * tiny on purpose so it never bloats an agent's context (progressive
 * disclosure happens after the agent installs the skill on disk).
 */
export async function getControlPlaneSkillInfo(): Promise<ControlPlaneSkillInfo> {
  const meta = await readSkillMeta();
  const downloadUrl = `${config.PUBLIC_BASE_URL}/api/skills/control-plane/bundle.skill`;
  const installPath = `.claude/skills/${CONTROL_PLANE_SKILL_NAME}/`;
  return {
    name: meta.name ?? CONTROL_PLANE_SKILL_NAME,
    description: meta.description,
    filename: CONTROL_PLANE_SKILL_FILENAME,
    downloadUrl,
    installPath,
    install:
      `Download the bundle and unzip it into your skills directory, e.g.: ` +
      `curl -fsSL "${downloadUrl}" -o /tmp/${CONTROL_PLANE_SKILL_FILENAME} && ` +
      `unzip -o /tmp/${CONTROL_PLANE_SKILL_FILENAME} -d .claude/skills/. ` +
      `No authentication is required to download. Re-run to refresh to the latest version.`,
  };
}
