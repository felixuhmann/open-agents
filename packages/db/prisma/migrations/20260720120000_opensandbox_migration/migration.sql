-- Forward-only cutover from the legacy sandbox provider to self-hosted
-- OpenSandbox + Kata. Historical runs, events, immutable version payloads, and
-- provider metadata remain truthful; only live bindings move forward.
--
-- Before deploying, export any workspace-only files and delete remote legacy
-- sandboxes while the old provider credential still works.

BEGIN;

ALTER TABLE "AgentSandbox"
  ADD COLUMN "retiredAt" TIMESTAMP(3),
  ADD COLUMN "retiredReason" TEXT;

CREATE INDEX "AgentSandbox_provider_retiredAt_idx"
  ON "AgentSandbox"("provider", "retiredAt");

-- Live surfaces must provision a fresh OpenSandbox workspace on next use.
UPDATE "ChatConversation" SET "sessionId" = NULL WHERE "sessionId" LIKE 'daytona:%';
UPDATE "EmailThread" SET "sessionId" = NULL WHERE "sessionId" LIKE 'daytona:%';
DELETE FROM "WorkflowAgentSession" WHERE "sessionId" LIKE 'daytona:%';

-- Keep provider metadata available to historical traces while releasing unique
-- conversation/thread bindings for successor OpenSandbox rows.
UPDATE "AgentSandbox"
SET
  "conversationId" = NULL,
  "threadId" = NULL,
  "retiredAt" = CURRENT_TIMESTAMP,
  "retiredReason" = 'provider_cutover_to_opensandbox'
WHERE "provider" = 'daytona';

-- Clone immutable agent snapshots. Existing AgentRun.agentVersionId references
-- continue pointing at their original payload; new runs use the cloned current
-- version whose runtime backend is OpenSandbox.
CREATE TEMP TABLE "_opensandbox_agent_version_map" ON COMMIT DROP AS
WITH maximums AS (
  SELECT "agentId", MAX("versionNumber") AS max_version
  FROM "AgentVersion"
  GROUP BY "agentId"
)
SELECT
  old."id" AS old_id,
  ('opensandbox_' || old."id") AS new_id,
  old."agentId" AS agent_id,
  (
    maximums.max_version
    + ROW_NUMBER() OVER (
        PARTITION BY old."agentId"
        ORDER BY old."versionNumber", old."id"
      )
  )::INTEGER AS new_version_number
FROM "AgentVersion" old
JOIN maximums ON maximums."agentId" = old."agentId"
WHERE old."payload"::jsonb #>> '{runtime,backend}' = 'daytona';

INSERT INTO "AgentVersion" ("id", "agentId", "versionNumber", "payload", "createdAt")
SELECT
  map.new_id,
  old."agentId",
  map.new_version_number,
  jsonb_set(
    old."payload"::jsonb,
    '{runtime,backend}',
    '"opensandbox"'::jsonb,
    true
  ),
  CURRENT_TIMESTAMP
FROM "_opensandbox_agent_version_map" map
JOIN "AgentVersion" old ON old."id" = map.old_id;

-- A cloned caller must delegate to cloned OpenSandbox snapshots, not historical
-- legacy snapshots.
UPDATE "AgentVersion" cloned
SET "payload" = jsonb_set(
  cloned."payload"::jsonb,
  '{subagentBindings}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE
          WHEN referenced.new_id IS NULL THEN item.value
          ELSE item.value || jsonb_build_object('agentVersionId', referenced.new_id)
        END
        ORDER BY item.ordinality
      )
      FROM jsonb_array_elements(
        COALESCE(cloned."payload"::jsonb -> 'subagentBindings', '[]'::jsonb)
      ) WITH ORDINALITY AS item(value, ordinality)
      LEFT JOIN "_opensandbox_agent_version_map" referenced
        ON referenced.old_id = item.value ->> 'agentVersionId'
    ),
    '[]'::jsonb
  ),
  true
)
WHERE cloned."id" IN (SELECT new_id FROM "_opensandbox_agent_version_map");

UPDATE "Agent" agent
SET "currentVersionId" = map.new_id
FROM "_opensandbox_agent_version_map" map
WHERE agent."currentVersionId" = map.old_id;

-- Clone each current workflow snapshot and remap its pinned agent versions.
CREATE TEMP TABLE "_opensandbox_workflow_version_map" ON COMMIT DROP AS
SELECT
  current_version."id" AS old_id,
  ('opensandbox_' || current_version."id") AS new_id,
  current_version."workflowId" AS workflow_id,
  (
    SELECT MAX(all_versions."versionNumber") + 1
    FROM "WorkflowVersion" all_versions
    WHERE all_versions."workflowId" = current_version."workflowId"
  )::INTEGER AS new_version_number
FROM "Workflow" workflow
JOIN "WorkflowVersion" current_version
  ON current_version."id" = workflow."currentVersionId";

INSERT INTO "WorkflowVersion" ("id", "workflowId", "versionNumber", "payload", "createdAt")
SELECT
  workflow_map.new_id,
  old."workflowId",
  workflow_map.new_version_number,
  jsonb_set(
    old."payload"::jsonb,
    '{steps}',
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN agent_map.new_id IS NULL THEN step.value
            ELSE step.value || jsonb_build_object(
              'agentVersionId', agent_map.new_id,
              'agentVersionNumber', agent_map.new_version_number
            )
          END
          ORDER BY step.ordinality
        )
        FROM jsonb_array_elements(
          COALESCE(old."payload"::jsonb -> 'steps', '[]'::jsonb)
        ) WITH ORDINALITY AS step(value, ordinality)
        LEFT JOIN "_opensandbox_agent_version_map" agent_map
          ON agent_map.old_id = step.value ->> 'agentVersionId'
      ),
      '[]'::jsonb
    ),
    true
  ),
  CURRENT_TIMESTAMP
FROM "_opensandbox_workflow_version_map" workflow_map
JOIN "WorkflowVersion" old ON old."id" = workflow_map.old_id;

UPDATE "Workflow" workflow
SET "currentVersionId" = map.new_id
FROM "_opensandbox_workflow_version_map" map
WHERE workflow."currentVersionId" = map.old_id;

-- These handles are provider-specific caches. Bytes and logical mount paths stay
-- durable and can be materialized into a new OpenSandbox workspace.
UPDATE "ChatAttachment" SET "backendFileId" = NULL WHERE "backendFileId" IS NOT NULL;
UPDATE "EmailAttachment" SET "backendFileId" = NULL WHERE "backendFileId" IS NOT NULL;
UPDATE "WorkflowAttachment" SET "backendFileId" = NULL WHERE "backendFileId" IS NOT NULL;
UPDATE "WorkflowEmailAttachment" SET "backendFileId" = NULL WHERE "backendFileId" IS NOT NULL;

-- Remove the obsolete encrypted provider credential after operator cleanup.
DELETE FROM "Secret" WHERE "key" = 'daytona_api_key';

COMMIT;
