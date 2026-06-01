import { useCallback, useState, type DragEvent, type ReactNode } from "react";
import { UploadSimpleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

function transferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

type Props = {
  children: ReactNode;
  onFiles: (files: FileList) => void;
  disabled?: boolean;
  className?: string;
};

export function ChatFileDropZone({
  children,
  onFiles,
  disabled = false,
  className,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const resetDrag = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    const related = e.relatedTarget;
    if (related instanceof Node && e.currentTarget.contains(related)) return;
    resetDrag();
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    resetDrag();
    const { files } = e.dataTransfer;
    if (files && files.length > 0) onFiles(files);
  };

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
      {isDragging ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-background/85 backdrop-blur-[2px]"
          aria-hidden
        >
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <UploadSimpleIcon className="size-10 text-primary" weight="duotone" />
            <p className="font-heading text-sm font-semibold">Drop files to attach</p>
            <p className="text-xs text-muted-foreground">Up to 25 MB per file</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
