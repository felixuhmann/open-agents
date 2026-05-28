-- AlterTable
ALTER TABLE "AgentVersion" ALTER COLUMN "versionNumber" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Skill" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "AgentSandbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSandboxId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'unknown',
    "agentId" TEXT NOT NULL,
    "surface" TEXT,
    "conversationId" TEXT,
    "threadId" TEXT,
    "lifecyclePolicy" JSONB NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "errorReason" TEXT,
    "recoverable" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSandbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentSandbox_sessionId_key" ON "AgentSandbox"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSandbox_conversationId_key" ON "AgentSandbox"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSandbox_threadId_key" ON "AgentSandbox"("threadId");

-- CreateIndex
CREATE INDEX "AgentSandbox_agentId_idx" ON "AgentSandbox"("agentId");

-- CreateIndex
CREATE INDEX "AgentSandbox_state_lastActivityAt_idx" ON "AgentSandbox"("state", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSandbox_provider_providerSandboxId_key" ON "AgentSandbox"("provider", "providerSandboxId");

-- AddForeignKey
ALTER TABLE "AgentSandbox" ADD CONSTRAINT "AgentSandbox_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSandbox" ADD CONSTRAINT "AgentSandbox_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSandbox" ADD CONSTRAINT "AgentSandbox_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
