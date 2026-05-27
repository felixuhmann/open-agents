import { access } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the `apps/api` package root. Skill bundle bytes must resolve
 * relative to this directory — not `process.cwd()` — so materialization still
 * works when the API is started from the monorepo root or a container WORKDIR
 * that is not `apps/api/`.
 */
export const API_PACKAGE_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);

/**
 * Directory where uploaded skill zip bundles are stored on disk.
 * `SKILL_BUNDLE_DIR` may be absolute or relative to `API_PACKAGE_ROOT`.
 */
export function getSkillBundleDir(): string {
  const configured = process.env.SKILL_BUNDLE_DIR;
  if (!configured) return join(API_PACKAGE_ROOT, "data", "skills");
  return isAbsolute(configured) ? configured : join(API_PACKAGE_ROOT, configured);
}

/** Value persisted on `SkillVersion.bundleStorageRef` (basename only). */
export function toBundleStorageRef(fileName: string): string {
  const base = basename(fileName);
  if (!base || base === "." || base === "..") {
    throw new Error("invalid skill bundle filename");
  }
  return base;
}

/** Absolute path for writing or deleting a bundle on disk. */
export function bundlePathForStorageRef(storageRef: string): string {
  return join(getSkillBundleDir(), toBundleStorageRef(storageRef));
}

function candidateBundlePaths(storageRef: string): string[] {
  const bundleDir = getSkillBundleDir();
  const fileName = toBundleStorageRef(storageRef);
  const out: string[] = [];

  if (isAbsolute(storageRef)) out.push(storageRef);

  // Canonical layout: basename under the configured bundle dir.
  out.push(join(bundleDir, fileName));

  // Legacy rows store `data/skills/<file>.zip` (CWD-relative at upload time).
  if (storageRef.includes("/") || storageRef.includes("\\")) {
    out.push(join(API_PACKAGE_ROOT, storageRef));
    out.push(join(process.cwd(), storageRef));
    out.push(join(process.cwd(), "apps", "api", storageRef));
  }

  return [...new Set(out)];
}

/**
 * Resolve a `SkillVersion.bundleStorageRef` to an on-disk zip path.
 * Returns `null` when no candidate exists (missing volume, wrong host, etc.).
 */
export async function resolveSkillBundlePath(storageRef: string): Promise<string | null> {
  for (const path of candidateBundlePaths(storageRef)) {
    try {
      await access(path);
      return path;
    } catch {
      // try next candidate
    }
  }
  return null;
}
