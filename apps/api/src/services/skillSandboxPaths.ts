/**
 * Pure path helpers for skill materialization. Kept separate from
 * `materializeSkills.ts` (which reads bundle bytes from disk and the
 * database) so prompts and tests can resolve skill paths cheaply.
 */

/**
 * Subdirectory of the sandbox working directory where bound skills are
 * unpacked. Combined with the sandbox's resolved workspace dir to produce an
 * absolute mount path.
 */
export const SKILL_SANDBOX_SUBDIR = ".agents/skills";

export function skillSandboxRootFor(workspaceDir: string): string {
  const base = workspaceDir.endsWith("/") ? workspaceDir.slice(0, -1) : workspaceDir;
  return `${base}/${SKILL_SANDBOX_SUBDIR}`;
}

export function skillSlugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill";
}
