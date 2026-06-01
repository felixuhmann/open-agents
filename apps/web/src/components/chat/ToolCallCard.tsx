import { useState } from "react";
import { CaretRightIcon, WrenchIcon } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { CopyButton } from "@/components/chat/CopyButton";
import { cn } from "@/lib/utils";

type Props = {
  toolName: string;
  output: string;
  running?: boolean;
};

/** Collapsible card showing a single live tool invocation and its output. */
export function ToolCallCard({ toolName, output, running }: Props) {
  const [open, setOpen] = useState(true);
  const hasOutput = output.trim().length > 0;
  return (
    <div className="group/tool overflow-hidden border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/50"
      >
        <CaretRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          weight="bold"
        />
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium">{toolName}</span>
        {running ? (
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            <Spinner className="size-3" />
            Running
          </span>
        ) : (
          <span className="ml-auto text-muted-foreground">done</span>
        )}
      </button>
      {open && hasOutput ? (
        <div className="relative border-t border-border/70 bg-[var(--code-bg)]">
          <CopyButton
            getText={() => output}
            label="Copy output"
            className="absolute top-1 right-1 z-10 opacity-0 transition-opacity group-hover/tool:opacity-100"
          />
          <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
            {output}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
