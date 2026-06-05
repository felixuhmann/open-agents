-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN "emailEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workflow" ADD COLUMN "inboundLocalPart" TEXT;

UPDATE "Workflow" SET "inboundLocalPart" = "slug" WHERE "inboundLocalPart" IS NULL;

ALTER TABLE "Workflow" ALTER COLUMN "inboundLocalPart" SET NOT NULL;

CREATE UNIQUE INDEX "Workflow_inboundLocalPart_key" ON "Workflow"("inboundLocalPart");

-- AlterTable
ALTER TABLE "WorkflowRun" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "WorkflowRun" ADD COLUMN "emailThreadId" TEXT;

-- CreateTable
CREATE TABLE "WorkflowAttachment" (
    "id" TEXT NOT NULL,
    "workflowMessageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "backendFileId" TEXT,
    "mountPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEmailThread" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "inboundAddress" TEXT,
    "subject" TEXT NOT NULL,
    "rootMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowEmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEmailMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "direction" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEmailAttachment" (
    "id" TEXT NOT NULL,
    "workflowEmailMessageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "backendFileId" TEXT,
    "mountPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowAttachment_workflowMessageId_idx" ON "WorkflowAttachment"("workflowMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEmailThread_rootMessageId_key" ON "WorkflowEmailThread"("rootMessageId");

-- CreateIndex
CREATE INDEX "WorkflowEmailThread_workflowId_idx" ON "WorkflowEmailThread"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowEmailThread_userEmail_idx" ON "WorkflowEmailThread"("userEmail");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEmailMessage_messageId_key" ON "WorkflowEmailMessage"("messageId");

-- CreateIndex
CREATE INDEX "WorkflowEmailMessage_inReplyTo_idx" ON "WorkflowEmailMessage"("inReplyTo");

-- CreateIndex
CREATE INDEX "WorkflowEmailMessage_threadId_idx" ON "WorkflowEmailMessage"("threadId");

-- CreateIndex
CREATE INDEX "WorkflowEmailAttachment_workflowEmailMessageId_idx" ON "WorkflowEmailAttachment"("workflowEmailMessageId");

-- CreateIndex
CREATE INDEX "WorkflowRun_emailThreadId_idx" ON "WorkflowRun"("emailThreadId");

-- AddForeignKey
ALTER TABLE "WorkflowAttachment" ADD CONSTRAINT "WorkflowAttachment_workflowMessageId_fkey" FOREIGN KEY ("workflowMessageId") REFERENCES "WorkflowMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEmailThread" ADD CONSTRAINT "WorkflowEmailThread_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEmailMessage" ADD CONSTRAINT "WorkflowEmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WorkflowEmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEmailAttachment" ADD CONSTRAINT "WorkflowEmailAttachment_workflowEmailMessageId_fkey" FOREIGN KEY ("workflowEmailMessageId") REFERENCES "WorkflowEmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "WorkflowEmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
