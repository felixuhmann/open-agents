import { z } from "zod";

/** Outcome of unpacking one pinned skill version into a Daytona sandbox. */
export const SkillMaterializationStatus = z.enum([
  "materialized",
  "skipped",
  "missing",
  "invalid",
]);
export type SkillMaterializationStatus = z.infer<typeof SkillMaterializationStatus>;

export const SkillMaterializationEntry = z.object({
  skillId: z.string(),
  skillVersionId: z.string(),
  name: z.string(),
  slug: z.string(),
  versionNumber: z.number().int().positive(),
  sandboxPath: z.string(),
  status: SkillMaterializationStatus,
  fileCount: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type SkillMaterializationEntry = z.infer<typeof SkillMaterializationEntry>;

export const SkillMaterializationManifest = z.object({
  entries: z.array(SkillMaterializationEntry),
  materialized: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type SkillMaterializationManifest = z.infer<typeof SkillMaterializationManifest>;
