-- Scheduled tasks: cron-triggered agent/workflow prompts with durable history.
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetType" TEXT NOT NULL,
    "agentId" TEXT,
    "workflowId" TEXT,
    "userId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledTaskRun" (
    "id" TEXT NOT NULL,
    "scheduledTaskId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "conversationId" TEXT,
    "workflowConversationId" TEXT,
    "agentRunId" TEXT,
    "workflowRunId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledTaskRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledTask_agentId_idx" ON "ScheduledTask"("agentId");
CREATE INDEX "ScheduledTask_workflowId_idx" ON "ScheduledTask"("workflowId");
CREATE INDEX "ScheduledTask_userId_idx" ON "ScheduledTask"("userId");
CREATE INDEX "ScheduledTask_status_nextRunAt_idx" ON "ScheduledTask"("status", "nextRunAt");
CREATE INDEX "ScheduledTaskRun_scheduledTaskId_scheduledFor_idx" ON "ScheduledTaskRun"("scheduledTaskId", "scheduledFor");
CREATE INDEX "ScheduledTaskRun_status_idx" ON "ScheduledTaskRun"("status");
CREATE INDEX "ScheduledTaskRun_conversationId_idx" ON "ScheduledTaskRun"("conversationId");
CREATE INDEX "ScheduledTaskRun_workflowConversationId_idx" ON "ScheduledTaskRun"("workflowConversationId");

ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskRun" ADD CONSTRAINT "ScheduledTaskRun_scheduledTaskId_fkey" FOREIGN KEY ("scheduledTaskId") REFERENCES "ScheduledTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskRun" ADD CONSTRAINT "ScheduledTaskRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskRun" ADD CONSTRAINT "ScheduledTaskRun_workflowConversationId_fkey" FOREIGN KEY ("workflowConversationId") REFERENCES "WorkflowConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskRun" ADD CONSTRAINT "ScheduledTaskRun_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduledTaskRun" ADD CONSTRAINT "ScheduledTaskRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
