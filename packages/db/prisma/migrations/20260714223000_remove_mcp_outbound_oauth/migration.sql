-- Remove the abandoned hosted Google Drive MCP/OAuth integration while
-- keeping migration history forward-only for deployments that already ran it.
DELETE FROM "McpServer"
WHERE "serverUrl" = 'https://drivemcp.googleapis.com/mcp/v1';

DROP TABLE IF EXISTS "McpOAuthCredential";

ALTER TABLE "McpServer"
DROP COLUMN IF EXISTS "authType",
DROP COLUMN IF EXISTS "allowedTools";
