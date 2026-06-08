-- Add an optional category to agents for list-view grouping and filtering.
ALTER TABLE "Agent" ADD COLUMN "category" TEXT;

CREATE INDEX "Agent_category_idx" ON "Agent"("category");
