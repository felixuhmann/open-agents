-- Add optional profile fields users may share with profile-aware agents.
ALTER TABLE "user"
  ADD COLUMN "phoneNumber" TEXT,
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "company" TEXT,
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "timezone" TEXT;

-- Draft agent setting, frozen into AgentVersion payload on publish.
ALTER TABLE "Agent"
  ADD COLUMN "profileAccessEnabled" BOOLEAN NOT NULL DEFAULT false;
