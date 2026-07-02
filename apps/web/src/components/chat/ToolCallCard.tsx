import { useState } from "react";
import { CaretRightIcon, WrenchIcon } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { CopyButton } from "@/components/chat/CopyButton";
import { cn } from "@/lib/utils";

/** One item of a subagent's mirrored activity, shown in the nested panel. */
export type SubagentItem =
  | { type: "tool"; callId: string; toolName: string; output: string; done: boolean }
  | { type: "message"; text: string; isError?: boolean };

type Props = {
  toolName: string;
  output: string;
  running?: boolean;
  /** When set, renders a nested panel of a subagent's live activity. */
  subagentSlug?: string;
  subagentItems?: SubagentItem[];
};

/** Collapsible card showing a single live tool invocation and its output. */
export function ToolCallCard({
  toolName,
  output,
  running,
  subagentSlug,
  subagentItems,
}: Props) {
  const [open, setOpen] = useState(true);
  const hasOutput = output.trim().length > 0;
  const nested = subagentItems ?? [];
  const hasNested = nested.length > 0;
  const label = subagentSlug ? `${toolName} · ${subagentSlug}` : toolName;
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
        <span className="font-mono font-medium">{label}</span>
        {running ? (
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            <Spinner className="size-3" />
            Running
          </span>
        ) : (
          <span className="ml-auto text-muted-foreground">done</span>
        )}
      </button>
      {open && hasNested ? (
        <div className="border-t border-border/70 bg-muted/20 px-3 py-2">
          <SubagentActivity items={nested} />
        </div>
      ) : null}
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

/** Renders a subagent's mirrored tool calls and messages as a compact feed. */
function SubagentActivity({ items }: { items: SubagentItem[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {items.map((item, i) =>
        item.type === "tool" ? (
          <li key={`${item.callId}-${i}`} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <WrenchIcon className="size-3 shrink-0" />
              <span className="font-mono">{item.toolName}</span>
              {item.done ? (
                <span className="ml-auto">done</span>
              ) : (
                <span className="ml-auto flex items-center gap-1">
                  <Spinner className="size-2.5" />
                  running
                </span>
              )}
            </div>
            {item.output.trim().length > 0 ? (
              <pre className="max-h-40 overflow-auto border-l-2 border-border/60 pl-2 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                {item.output}
              </pre>
            ) : null}
          </li>
        ) : (
          <li
            key={`msg-${i}`}
            className={cn(
              "text-[11px] leading-relaxed break-words whitespace-pre-wrap",
              item.isError ? "text-destructive" : "text-foreground/80",
            )}
          >
            {item.text}
          </li>
        ),
      )}
    </ol>
  );
}
