-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "sandboxNetworkPolicy" JSONB,
ADD COLUMN "sandboxCommandPolicy" JSONB;
