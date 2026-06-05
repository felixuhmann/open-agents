-- AlterTable
ALTER TABLE "WorkflowAgentSession" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "WorkflowAgentSession" ADD COLUMN "emailThreadId" TEXT;

-- CreateIndex
CREATE INDEX "WorkflowAgentSession_emailThreadId_idx" ON "WorkflowAgentSession"("emailThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowAgentSession_emailThreadId_agentId_key" ON "WorkflowAgentSession"("emailThreadId", "agentId");

-- AddForeignKey
ALTER TABLE "WorkflowAgentSession" ADD CONSTRAINT "WorkflowAgentSession_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "WorkflowEmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
