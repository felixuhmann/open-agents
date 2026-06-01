ALTER TABLE "Agent"
  DROP COLUMN "anthropicAgentId",
  DROP COLUMN "environmentId",
  DROP COLUMN "anthropicAgentVersion",
  DROP COLUMN "anthropicMcpCredentialId",
  DROP COLUMN "anthropicMcpCredentialUrl";

ALTER TABLE "AgentVersion"
  DROP COLUMN "providerRefs",
  DROP COLUMN "anthropicVersion";

ALTER TABLE "SkillVersion"
  DROP COLUMN "anthropicSkillId",
  DROP COLUMN "anthropicSkillVersion";

UPDATE "AgentVersion"
SET "payload" = jsonb_set("payload"::jsonb, '{runtime,backend}', '"daytona"'::jsonb, true)
WHERE "payload" IS NOT NULL;

ALTER TABLE "ChatConversation" RENAME COLUMN "anthropicSessionId" TO "sessionId";
ALTER INDEX "ChatConversation_anthropicSessionId_key" RENAME TO "ChatConversation_sessionId_key";

ALTER TABLE "ChatAttachment" RENAME COLUMN "anthropicFileId" TO "backendFileId";
ALTER TABLE "EmailAttachment" RENAME COLUMN "anthropicFileId" TO "backendFileId";
