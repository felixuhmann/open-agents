-- Persist the replayable Pi context checkpoint produced by each successful
-- application turn. This keeps multi-turn context independent of API worker
-- lifetime while retaining tool calls, tool results, and provider metadata.
ALTER TABLE "AgentRun" ADD COLUMN "piContext" JSONB;

CREATE INDEX "AgentRun_threadId_status_startedAt_idx"
ON "AgentRun"("threadId", "status", "startedAt");

CREATE INDEX "AgentRun_conversationId_status_startedAt_idx"
ON "AgentRun"("conversationId", "status", "startedAt");
