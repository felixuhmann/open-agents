-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "serverUrl" TEXT NOT NULL,
    "bearerCipher" BYTEA,
    "bearerIv" BYTEA,
    "bearerTag" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMcpBinding" (
    "agentId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMcpBinding_pkey" PRIMARY KEY ("agentId","mcpServerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_name_key" ON "McpServer"("name");

-- CreateIndex
CREATE INDEX "AgentMcpBinding_mcpServerId_idx" ON "AgentMcpBinding"("mcpServerId");

-- AddForeignKey
ALTER TABLE "AgentMcpBinding" ADD CONSTRAINT "AgentMcpBinding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMcpBinding" ADD CONSTRAINT "AgentMcpBinding_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate legacy per-agent MCP rows into the library (preserve ids for published snapshots).
INSERT INTO "McpServer" (
    "id",
    "name",
    "label",
    "description",
    "serverUrl",
    "bearerCipher",
    "bearerIv",
    "bearerTag",
    "createdAt",
    "updatedAt"
)
SELECT
    t."id",
    t."name",
    t."label",
    NULL,
    t."serverUrl",
    t."bearerCipher",
    t."bearerIv",
    t."bearerTag",
    t."createdAt",
    t."createdAt"
FROM (
    SELECT
        m."id",
        m."label",
        m."serverUrl",
        m."bearerCipher",
        m."bearerIv",
        m."bearerTag",
        m."createdAt",
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM "AgentThirdPartyMcp" m2
                WHERE m2."label" = m."label"
                  AND m2."id" <> m."id"
            ) THEN m."id"
            ELSE m."label"
        END AS "name"
    FROM "AgentThirdPartyMcp" m
) t;

INSERT INTO "AgentMcpBinding" ("agentId", "mcpServerId", "createdAt")
SELECT "agentId", "id", "createdAt"
FROM "AgentThirdPartyMcp";

-- DropTable
DROP TABLE "AgentThirdPartyMcp";
