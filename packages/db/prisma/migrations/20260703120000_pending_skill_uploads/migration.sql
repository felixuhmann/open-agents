-- One-shot, short-lived authorization to upload a skill bundle out-of-band
-- (the "signed URL" target for the skills_create MCP tool). Only the SHA-256
-- hash of the opaque token is stored; consumedAt makes uploads single-use.
CREATE TABLE "PendingSkillUpload" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingSkillUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingSkillUpload_tokenHash_key" ON "PendingSkillUpload"("tokenHash");

CREATE INDEX "PendingSkillUpload_expiresAt_idx" ON "PendingSkillUpload"("expiresAt");
