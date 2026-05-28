-- Provider-neutral agent versioning: pin runs to frozen config snapshots.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "currentVersionId" TEXT;

-- AlterTable
ALTER TABLE "AgentVersion" ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AgentVersion" ADD COLUMN "providerRefs" JSONB;

-- Backfill monotonic version numbers per agent (oldest publish = 1).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "agentId" ORDER BY "createdAt" ASC) AS vn
  FROM "AgentVersion"
)
UPDATE "AgentVersion" av
SET "versionNumber" = ranked.vn
FROM ranked
WHERE av.id = ranked.id;

-- Point each agent at its latest published version.
UPDATE "Agent" a
SET "currentVersionId" = latest.id
FROM (
  SELECT DISTINCT ON ("agentId") id, "agentId"
  FROM "AgentVersion"
  ORDER BY "agentId", "createdAt" DESC
) latest
WHERE a.id = latest."agentId";

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "agentVersionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Agent_currentVersionId_key" ON "Agent"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVersion_agentId_versionNumber_key" ON "AgentVersion"("agentId", "versionNumber");

-- CreateIndex
CREATE INDEX "AgentRun_agentVersionId_idx" ON "AgentRun"("agentVersionId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
