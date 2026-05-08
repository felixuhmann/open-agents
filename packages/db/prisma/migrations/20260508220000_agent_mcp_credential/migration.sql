-- Track the Anthropic vault credential the publish flow now provisions
-- automatically per agent that binds platform MCP tools.
--
-- `anthropicMcpCredentialId` is the `vcrd_…` Anthropic returns; we PATCH
-- it on subsequent publishes to refresh the bearer instead of creating a
-- new credential each time.
--
-- `anthropicMcpCredentialUrl` records the MCP URL the credential is bound
-- to. Anthropic treats `mcp_server_url` as immutable, so when this value
-- diverges from the freshly-computed `${PUBLIC_BASE_URL}/mcp/${slug}` we
-- delete + recreate.

ALTER TABLE "Agent"
  ADD COLUMN "anthropicMcpCredentialId" TEXT,
  ADD COLUMN "anthropicMcpCredentialUrl" TEXT;
