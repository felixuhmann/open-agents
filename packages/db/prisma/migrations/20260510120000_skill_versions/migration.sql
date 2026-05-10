-- Split skill library rows from immutable uploaded bundle versions.
CREATE TABLE "SkillVersion" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "bundleStorageRef" TEXT NOT NULL,
    "anthropicSkillId" TEXT,
    "anthropicSkillVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillVersion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SkillVersion" (
    "id",
    "skillId",
    "versionNumber",
    "filename",
    "bundleStorageRef",
    "anthropicSkillId",
    "anthropicSkillVersion",
    "createdAt"
)
SELECT
    "id",
    "id",
    1,
    "name" || '.zip',
    "bundleStorageRef",
    "anthropicSkillId",
    "anthropicSkillVersion",
    "createdAt"
FROM "Skill";

ALTER TABLE "AgentSkillBinding" ADD COLUMN "skillVersionId" TEXT;

UPDATE "AgentSkillBinding"
SET "skillVersionId" = "skillId"
WHERE "skillVersionId" IS NULL;

ALTER TABLE "AgentSkillBinding" ALTER COLUMN "skillVersionId" SET NOT NULL;

ALTER TABLE "Skill" DROP COLUMN "bundleStorageRef";
ALTER TABLE "Skill" DROP COLUMN "anthropicSkillId";
ALTER TABLE "Skill" DROP COLUMN "anthropicSkillVersion";
ALTER TABLE "Skill" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "SkillVersion_skillId_versionNumber_key" ON "SkillVersion"("skillId", "versionNumber");
CREATE INDEX "SkillVersion_skillId_idx" ON "SkillVersion"("skillId");
CREATE INDEX "AgentSkillBinding_skillVersionId_idx" ON "AgentSkillBinding"("skillVersionId");

ALTER TABLE "SkillVersion" ADD CONSTRAINT "SkillVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSkillBinding" ADD CONSTRAINT "AgentSkillBinding_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "SkillVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
