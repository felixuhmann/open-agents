-- Optional, revocable public link for an agent.
ALTER TABLE "Agent" ADD COLUMN "publicShareToken" TEXT;

CREATE UNIQUE INDEX "Agent_publicShareToken_key" ON "Agent"("publicShareToken");

-- Anonymous conversations are isolated with a separate browser capability.
ALTER TABLE "ChatConversation"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "publicAccessTokenHash" TEXT;

CREATE UNIQUE INDEX "ChatConversation_publicAccessTokenHash_key"
  ON "ChatConversation"("publicAccessTokenHash");
