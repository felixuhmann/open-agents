import { DownloadSimpleIcon, FileIcon } from "@phosphor-icons/react";
import { runAttachmentDownloadUrl, useRunAttachments } from "@/lib/queries";
import { formatBytes } from "@/components/chat/utils";

export function AssistantRunAttachments({ runId }: { runId: string }) {
  const q = useRunAttachments(runId);
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a) => (
        <a
          key={a.id}
          href={runAttachmentDownloadUrl(runId, a.id)}
          download={a.filename}
          className="inline-flex items-center gap-1.5 border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
        >
          <FileIcon className="size-3.5" />
          <span className="max-w-[18rem] truncate" title={a.filename}>
            {a.filename}
          </span>
          <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
          <DownloadSimpleIcon className="size-3.5" />
        </a>
      ))}
    </div>
  );
}
