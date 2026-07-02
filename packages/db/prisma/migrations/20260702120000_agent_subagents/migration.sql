-- Subagents: directed "can delegate to" edges between agents, plus parent
-- linkage on AgentRun so nested delegations form an inspectable tree.
CREATE TABLE "AgentSubagentBinding" (
    "agentId" TEXT NOT NULL,
    "subagentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSubagentBinding_pkey" PRIMARY KEY ("agentId", "subagentId")
);

CREATE INDEX "AgentSubagentBinding_subagentId_idx" ON "AgentSubagentBinding"("subagentId");

ALTER TABLE "AgentSubagentBinding" ADD CONSTRAINT "AgentSubagentBinding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSubagentBinding" ADD CONSTRAINT "AgentSubagentBinding_subagentId_fkey" FOREIGN KEY ("subagentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Parent run linkage for delegated (surface = 'subagent') runs.
ALTER TABLE "AgentRun" ADD COLUMN "parentRunId" TEXT;

CREATE INDEX "AgentRun_parentRunId_idx" ON "AgentRun"("parentRunId");

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
