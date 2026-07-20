import { posix as path } from "node:path";
import type {
  SkillMaterializationEntry,
  SkillMaterializationManifest,
} from "@open-agents/types";
import yauzl from "yauzl";
import type { HydratedAgent } from "../agents/service.js";
import { ensureSandboxDir } from "../agent-backend/opensandbox/workspace.js";
import type { SandboxFsHandle } from "../agent-backend/opensandbox/transport.js";
import { log } from "../log.js";
import { readSkillBundle } from "./skills.js";

/**
 * Subdirectory of the sandbox working directory where bound skills are
 * unpacked. Combined with the resolved workspaceDir (see
 * `resolveSandboxWorkspaceDir`) to produce an absolute mount path.
 */
export const SKILL_SANDBOX_SUBDIR = ".agents/skills";

/**
 * Resolve the absolute directory inside the sandbox where skill bundles
 * should be unpacked, given the sandbox's actual working directory.
 */
export function skillSandboxRootFor(workspaceDir: string): string {
  const base = workspaceDir.endsWith("/") ? workspaceDir.slice(0, -1) : workspaceDir;
  return `${base}/${SKILL_SANDBOX_SUBDIR}`;
}

export type SkillSandbox = {
  fs: Pick<SandboxFsHandle, "mkdirp" | "writeFile">;
};

export function skillSlugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill";
}

function normalizeZipEntryPath(fileName: string): string | null {
  const normalized = fileName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

type UnzippedFile = { path: string; content: Buffer };

function isJunkZipEntry(file: UnzippedFile): boolean {
  return (
    file.path === ".DS_Store" ||
    file.path.endsWith("/.DS_Store") ||
    file.path.startsWith("__MACOSX/")
  );
}

function stripSingleRootDirectory(files: UnzippedFile[]): UnzippedFile[] {
  const contentFiles = files.filter((file) => !isJunkZipEntry(file));
  if (contentFiles.some((file) => file.path === "SKILL.md")) return files;

  const roots = new Set(
    contentFiles.map((file) => file.path.split("/")[0]).filter(Boolean),
  );
  if (roots.size !== 1) return files;

  const [root] = [...roots];
  const prefix = `${root}/`;
  if (!contentFiles.some((file) => file.path === `${prefix}SKILL.md`)) return files;

  return contentFiles.map((file) => ({
    ...file,
    path: file.path.slice(prefix.length),
  }));
}

async function unzipSkillBundle(
  bytes: Buffer,
): Promise<{ ok: true; files: UnzippedFile[] } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        resolve({ ok: false, reason: "not a valid zip file" });
        return;
      }
      const files: UnzippedFile[] = [];
      let pending = 0;
      let ended = false;

      const finish = () => {
        if (ended && pending === 0) {
          resolve({ ok: true, files: stripSingleRootDirectory(files) });
        }
      };

      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith("/")) {
          zip.readEntry();
          return;
        }
        const rel = normalizeZipEntryPath(entry.fileName);
        if (!rel) {
          zip.readEntry();
          return;
        }
        pending += 1;
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            pending -= 1;
            zip.readEntry();
            finish();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            files.push({ path: rel, content: Buffer.concat(chunks) });
            pending -= 1;
            zip.readEntry();
            finish();
          });
          stream.on("error", () => {
            pending -= 1;
            zip.readEntry();
            finish();
          });
        });
      });
      zip.on("end", () => {
        ended = true;
        finish();
      });
      zip.on("error", () => resolve({ ok: false, reason: "zip read error" }));
      zip.readEntry();
    });
  });
}

async function uploadSkillFile(
  sandbox: SkillSandbox,
  remotePath: string,
  content: Buffer,
): Promise<void> {
  await ensureSandboxDir(sandbox.fs, path.dirname(remotePath));
  await sandbox.fs.writeFile(remotePath, content);
}

/**
 * Copy each pinned skill bundle from local disk into the sandbox. Skills are
 * unpacked under `<workspaceDir>/.agents/skills/<slug>/` so the Pi agent can
 * read them with the same paths as Cursor-style skill folders. The workspace
 * is the deterministic guest WORKDIR (`/workspace`).
 */
export async function materializeAgentSkills(
  sandbox: SkillSandbox,
  bindings: HydratedAgent["skillBindings"],
  workspaceDir: string,
): Promise<SkillMaterializationManifest> {
  const entries: SkillMaterializationEntry[] = [];
  const skillsRoot = skillSandboxRootFor(workspaceDir);

  if (!bindings.length) {
    log.info("skills: materialize skipped — no bindings");
    return { entries, materialized: 0, skipped: 0, failed: 0 };
  }

  for (const binding of bindings) {
    const slug = skillSlugFromName(binding.skill.name);
    const sandboxPath = `${skillsRoot}/${slug}`;
    const base = {
      skillId: binding.skillId,
      skillVersionId: binding.skillVersionId,
      name: binding.skill.name,
      slug,
      versionNumber: binding.skillVersion.versionNumber,
      sandboxPath,
    };

    const bytes = await readSkillBundle(binding.skillVersionId);
    if (!bytes) {
      entries.push({
        ...base,
        status: "missing",
        error: "bundle not found on disk",
      });
      log.warn("skills: bundle missing", {
        skillId: binding.skillId,
        skillVersionId: binding.skillVersionId,
        versionNumber: binding.skillVersion.versionNumber,
      });
      continue;
    }

    const unpacked = await unzipSkillBundle(bytes);
    if (!unpacked.ok) {
      entries.push({ ...base, status: "invalid", error: unpacked.reason });
      log.warn("skills: invalid bundle", {
        skillId: binding.skillId,
        skillVersionId: binding.skillVersionId,
        reason: unpacked.reason,
      });
      continue;
    }

    if (!unpacked.files.length) {
      entries.push({
        ...base,
        status: "invalid",
        error: "bundle contained no files",
      });
      continue;
    }

    try {
      for (const file of unpacked.files) {
        await uploadSkillFile(sandbox, `${sandboxPath}/${file.path}`, file.content);
      }
      entries.push({
        ...base,
        status: "materialized",
        fileCount: unpacked.files.length,
      });
      log.info("skills: materialized", {
        skillId: binding.skillId,
        skillVersionId: binding.skillVersionId,
        sandboxPath,
        fileCount: unpacked.files.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entries.push({ ...base, status: "invalid", error: message });
      log.warn("skills: upload failed", {
        skillId: binding.skillId,
        skillVersionId: binding.skillVersionId,
        err: message,
      });
    }
  }

  const materialized = entries.filter((e) => e.status === "materialized").length;
  const failed = entries.filter(
    (e) => e.status === "missing" || e.status === "invalid",
  ).length;
  const skipped = entries.filter((e) => e.status === "skipped").length;

  log.info("skills: materialize complete", {
    total: entries.length,
    materialized,
    failed,
    skipped,
  });

  return { entries, materialized, skipped, failed };
}
