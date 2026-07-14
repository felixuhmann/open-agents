-- Add refreshable OAuth authentication and least-privilege tool filtering to
-- deployment-wide remote MCP servers.
ALTER TABLE "McpServer"
ADD COLUMN "authType" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN "allowedTools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preserve existing static bearer behavior.
UPDATE "McpServer"
SET "authType" = 'bearer'
WHERE "bearerCipher" IS NOT NULL
  AND "bearerIv" IS NOT NULL
  AND "bearerTag" IS NOT NULL;

CREATE TABLE "McpOAuthCredential" (
    "id" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "encryptedValue" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "expiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpOAuthCredential_mcpServerId_key"
ON "McpOAuthCredential"("mcpServerId");

ALTER TABLE "McpOAuthCredential"
ADD CONSTRAINT "McpOAuthCredential_mcpServerId_fkey"
FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
