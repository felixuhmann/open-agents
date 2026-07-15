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

/**
 * Body for `POST /api/skills/upload-requests` — the first leg of the two-step,
 * signed-URL skill upload driven by the `skills_create` control-plane MCP tool.
 * Shared so the route and the MCP tool validate the same shape.
 */
export const CreateSkillUploadRequestInput = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Skill name. If a skill with this name already exists the upload becomes a new version of it; otherwise a new skill is created.",
    ),
  description: z
    .string()
    .optional()
    .describe("Description, applied only when the upload creates a brand-new skill."),
});
export type CreateSkillUploadRequestInput = z.infer<typeof CreateSkillUploadRequestInput>;

/** Response of `POST /api/skills/upload-requests`: the signed upload URL. */
export const CreateSkillUploadRequestResult = z.object({
  action: z.enum(["new_skill", "new_version"]),
  skillName: z.string(),
  uploadUrl: z.string().url(),
  method: z.literal("PUT"),
  contentType: z.literal("application/zip"),
  expiresAt: z.string(),
});
export type CreateSkillUploadRequestResult = z.infer<
  typeof CreateSkillUploadRequestResult
>;
