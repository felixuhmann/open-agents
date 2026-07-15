import { runAttachmentDownloadUrl, useRunAttachments } from "@/lib/queries";
import { AiRunAttachments } from "@/components/chat/AiChat";

export function AssistantRunAttachments({ runId }: { runId: string }) {
  const q = useRunAttachments(runId);
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <AiRunAttachments
      attachments={items.map((attachment) => ({
        ...attachment,
        href: runAttachmentDownloadUrl(runId, attachment.id),
      }))}
    />
  );
}
