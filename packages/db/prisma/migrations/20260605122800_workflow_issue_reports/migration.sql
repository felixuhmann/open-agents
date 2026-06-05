-- Allow issue reports to target workflows as well as individual agents.
ALTER TABLE "Issue" ALTER COLUMN "agentId" DROP NOT NULL;

ALTER TABLE "Issue" ADD COLUMN "workflowId" TEXT;
ALTER TABLE "Issue" ADD COLUMN "workflowConversationId" TEXT;

ALTER TABLE "Issue"
  ADD CONSTRAINT "Issue_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Issue"
  ADD CONSTRAINT "Issue_workflowConversationId_fkey"
  FOREIGN KEY ("workflowConversationId") REFERENCES "WorkflowConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Issue_workflowId_idx" ON "Issue"("workflowId");
CREATE INDEX "Issue_workflowConversationId_idx" ON "Issue"("workflowConversationId");
