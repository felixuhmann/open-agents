-- Unify the tool model and add Agent.model.
--
-- Replaces `McpToolDef` with `Tool` (gains `runtime` + `deprecated`),
-- folds `AgentBuiltinBinding` rows into `AgentToolBinding` against
-- managed-runtime `Tool` rows, drops the now-redundant `AgentBuiltinBinding`
-- table, and adds `Agent.model` so admins can pick which Anthropic model
-- powers the published agent.
--
-- Migration is data-preserving for platform tools; built-in bindings are
-- remapped onto the new managed-runtime catalog (`text_editor` →
-- `read,write,edit`; `code_execution` and `file_search` are dropped — they
-- do not exist in the Managed Agents `agent_toolset_20260401` toolset).

BEGIN;

-- 1. Add Agent.model with a sensible default.
ALTER TABLE "Agent"
  ADD COLUMN "model" TEXT NOT NULL DEFAULT 'claude-opus-4-7';

-- 2. Rename the catalog table and reshape it into the unified `Tool`.
ALTER TABLE "McpToolDef" RENAME TO "Tool";
ALTER TABLE "Tool" RENAME COLUMN "handlerKey" TO "key";
ALTER INDEX "McpToolDef_handlerKey_key" RENAME TO "Tool_key_key";
ALTER TABLE "Tool" RENAME CONSTRAINT "McpToolDef_pkey" TO "Tool_pkey";

-- The legacy `kind` column ("platform") is replaced by `runtime` with the
-- same default, plus a `deprecated` soft-hide flag.
ALTER TABLE "Tool"
  RENAME COLUMN "kind" TO "runtime";
ALTER TABLE "Tool"
  ALTER COLUMN "runtime" SET DEFAULT 'platform';
ALTER TABLE "Tool"
  ADD COLUMN "deprecated" BOOLEAN NOT NULL DEFAULT false;

-- 3. Rename the binding column + indexes/constraints to follow `tool*`.
ALTER TABLE "AgentToolBinding" RENAME COLUMN "toolDefId" TO "toolId";
ALTER INDEX "AgentToolBinding_toolDefId_idx" RENAME TO "AgentToolBinding_toolId_idx";
ALTER INDEX "AgentToolBinding_agentId_toolDefId_key" RENAME TO "AgentToolBinding_agentId_toolId_key";
ALTER TABLE "AgentToolBinding"
  DROP CONSTRAINT "AgentToolBinding_toolDefId_fkey";
ALTER TABLE "AgentToolBinding"
  ADD CONSTRAINT "AgentToolBinding_toolId_fkey"
    FOREIGN KEY ("toolId") REFERENCES "Tool"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Seed the managed-runtime catalog rows for `agent_toolset_20260401`.
--    Idempotent on `key` so the boot-time seeder can keep ownership.
INSERT INTO "Tool" ("id", "key", "name", "description", "runtime", "configSchema", "requiresSecrets", "deprecated", "createdAt") VALUES
  ('tool_managed_bash',       'bash',       'Bash',          'Execute bash commands in a shell session.',                          'managed', '{}', false, false, NOW()),
  ('tool_managed_read',       'read',       'Read file',     'Read a file from the workspace (text, image, PDF, ipynb).',          'managed', '{}', false, false, NOW()),
  ('tool_managed_write',      'write',      'Write file',    'Write a file to the workspace.',                                     'managed', '{}', false, false, NOW()),
  ('tool_managed_edit',       'edit',       'Edit file',     'String replacement in a file.',                                      'managed', '{}', false, false, NOW()),
  ('tool_managed_glob',       'glob',       'Glob',          'Fast file pattern matching using glob patterns.',                    'managed', '{}', false, false, NOW()),
  ('tool_managed_grep',       'grep',       'Grep',          'Regex text search across files.',                                    'managed', '{}', false, false, NOW()),
  ('tool_managed_web_fetch',  'web_fetch',  'Web fetch',     'Fetch the contents of a URL.',                                       'managed', '{}', false, false, NOW()),
  ('tool_managed_web_search', 'web_search', 'Web search',    'Search the web for information.',                                    'managed', '{}', false, false, NOW())
ON CONFLICT ("key") DO NOTHING;

-- 5. Migrate existing `AgentBuiltinBinding` rows into `AgentToolBinding`.
--    `bash` and `web_fetch` map 1:1; `text_editor` fans out to read+write+edit
--    (the closest behavioural match in the new toolset). `code_execution`
--    and `file_search` have no counterpart in `agent_toolset_20260401` and
--    are silently dropped — admins will see the change on the edit page and
--    can re-pick whatever they actually want.
INSERT INTO "AgentToolBinding" ("id", "agentId", "toolId", "configJson", "createdAt")
SELECT
  -- Stable id so the migration is repeatable and won't collide with cuid()s.
  'tb_' || b."agentId" || '_' || t."key",
  b."agentId",
  t."id",
  '{}'::jsonb,
  NOW()
FROM "AgentBuiltinBinding" b
JOIN "Tool" t ON t."runtime" = 'managed' AND (
  (b."builtin" = 'bash'        AND t."key" = 'bash')        OR
  (b."builtin" = 'web_fetch'   AND t."key" = 'web_fetch')   OR
  (b."builtin" = 'text_editor' AND t."key" IN ('read', 'write', 'edit'))
)
ON CONFLICT ("agentId", "toolId") DO NOTHING;

-- 6. Drop the legacy table now that its rows live on `AgentToolBinding`.
DROP TABLE "AgentBuiltinBinding";

COMMIT;
