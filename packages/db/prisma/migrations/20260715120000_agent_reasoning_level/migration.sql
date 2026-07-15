-- Persist the provider-neutral Pi reasoning effort on agent drafts.
-- `high` preserves the runtime behavior used before this setting was editable.
ALTER TABLE "Agent" ADD COLUMN "reasoningLevel" TEXT NOT NULL DEFAULT 'high';
