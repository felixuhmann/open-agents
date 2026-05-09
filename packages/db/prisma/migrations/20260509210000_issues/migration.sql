-- Add the Issue table for user-filed reports of agent misbehaviour.
--
-- An issue points at exactly one session: either a ChatConversation
-- (surface = `chat`) or an EmailThread (surface = `email`). The reporter
-- is captured both as a soft FK (`reporterUserId`, `SET NULL` on user
-- delete) and a denormalised email so admins can identify email-only
-- reporters who never registered a User account.

CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "conversationId" TEXT,
    "threadId" TEXT,
    "reporterUserId" TEXT,
    "reporterEmail" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Issue_agentId_idx" ON "Issue"("agentId");
CREATE INDEX "Issue_conversationId_idx" ON "Issue"("conversationId");
CREATE INDEX "Issue_threadId_idx" ON "Issue"("threadId");
CREATE INDEX "Issue_status_idx" ON "Issue"("status");
CREATE INDEX "Issue_reporterUserId_idx" ON "Issue"("reporterUserId");

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_reporterUserId_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
