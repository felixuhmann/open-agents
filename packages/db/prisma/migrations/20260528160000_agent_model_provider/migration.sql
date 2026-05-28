-- Replace single `model` string with explicit Pi provider + model id columns.

ALTER TABLE "Agent" ADD COLUMN "modelProvider" TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE "Agent" ADD COLUMN "modelId" TEXT NOT NULL DEFAULT 'claude-opus-4-7';

UPDATE "Agent"
SET
  "modelProvider" = 'anthropic',
  "modelId" = "model"
WHERE "model" IS NOT NULL AND "model" <> '';

ALTER TABLE "Agent" DROP COLUMN "model";
