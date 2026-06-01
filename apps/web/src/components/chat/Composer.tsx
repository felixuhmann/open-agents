import { useRef } from "react";
import { ArrowUpIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/components/chat/utils";
import { useAutosizeTextarea } from "@/hooks/use-autosize-textarea";
import { cn } from "@/lib/utils";

export type PendingUpload = {
  chatAttachmentId: string;
  chatMessageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFiles: (files: FileList | null) => void;
  pendingUploads: PendingUpload[];
  onRemoveUpload: (item: PendingUpload) => void;
  uploadingCount: number;
  sending: boolean;
  placeholder?: string;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  onFiles,
  pendingUploads,
  onRemoveUpload,
  uploadingCount,
  sending,
  placeholder = "Send a message…",
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutosizeTextarea(textareaRef, value);
  const canSend =
    !sending &&
    uploadingCount === 0 &&
    (value.trim().length > 0 || pendingUploads.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSubmit();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-2 border border-input bg-card px-2.5 pt-2 pb-2 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50">
        {pendingUploads.length > 0 || uploadingCount > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {pendingUploads.map((u) => (
              <Badge
                key={u.chatAttachmentId}
                variant="secondary"
                className="gap-1.5 pr-1 font-mono"
              >
                <PaperclipIcon data-icon="inline-start" />
                <span className="max-w-[16rem] truncate" title={u.filename}>
                  {u.filename}
                </span>
                <span className="text-muted-foreground">{formatBytes(u.sizeBytes)}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-5"
                  aria-label={`Remove ${u.filename}`}
                  onClick={() => onRemoveUpload(u)}
                  disabled={sending}
                >
                  <XIcon className="size-3" />
                </Button>
              </Badge>
            ))}
            {uploadingCount > 0 ? (
              <Badge variant="outline" className="gap-1.5 font-mono">
                <Spinner className="size-3" />
                Uploading {uploadingCount}…
              </Badge>
            ) : null}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            onFiles(e.target.files);
            if (e.target) e.target.value = "";
          }}
        />

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="max-h-56 min-h-9 w-full resize-none overflow-hidden bg-transparent px-1 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={sending || uploadingCount > 0}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            title="Attach files"
          >
            <PaperclipIcon className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              <kbd className="font-sans">Enter</kbd> to send,{" "}
              <kbd className="font-sans">Shift+Enter</kbd> for newline
            </span>
            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              aria-label="Send message"
              className={cn(!canSend && "opacity-60")}
            >
              {sending ? (
                <Spinner className="size-4" />
              ) : (
                <ArrowUpIcon className="size-4" weight="bold" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
