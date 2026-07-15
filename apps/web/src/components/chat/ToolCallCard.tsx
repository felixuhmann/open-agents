import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  BrainIcon,
  CaretRightIcon,
  CheckIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
  EnvelopeIcon,
  EyeIcon,
  FileMagnifyingGlassIcon,
  FileTextIcon,
  FolderOpenIcon,
  GlobeIcon,
  GoogleDriveLogoIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  RobotIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
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
  /** Redacted tool input, as emitted on the `tool.use` event. */
  args?: Record<string, unknown>;
  /** When set, renders a nested panel of a subagent's live activity. */
  subagentSlug?: string;
  subagentItems?: SubagentItem[];
};

/** Arg keys that best summarize a call, tried in priority order. */
const PRIMARY_ARG_KEYS = [
  "command",
  "query",
  "url",
  "file_path",
  "path",
  "file",
  "pattern",
  "prompt",
  "slug",
  "name",
  "id",
];

/** A short, single-line preview of the call's most meaningful input. */
function summarizeArgs(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  for (const key of PRIMARY_ARG_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return oneLine(v);
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }
  // Fall back to the sole string field, if there's exactly one.
  const strings = Object.values(args).filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  if (strings.length === 1 && strings[0]) return oneLine(strings[0]);
  return null;
}

function oneLine(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > 96 ? `${s.slice(0, 96)}…` : s;
}

/** Entries worth showing in the expanded input panel (skips empties). */
function argEntries(args?: Record<string, unknown>): [string, unknown][] {
  if (!args) return [];
  return Object.entries(args).filter(([, v]) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  });
}

type IconType = ComponentType<{ className?: string; weight?: "bold" | "fill" | "regular" }>;

/** Human-friendly label + icon for a raw tool name. */
function describeTool(toolName: string): { label: string; Icon: IconType } {
  const raw = toolName.trim();
  const name = raw.toLowerCase();
  const exact: Record<string, { label: string; Icon: IconType }> = {
    bash: { label: "Ran command", Icon: TerminalWindowIcon },
    view: { label: "Read file", Icon: EyeIcon },
    read: { label: "Read file", Icon: EyeIcon },
    write: { label: "Wrote file", Icon: PencilSimpleIcon },
    edit: { label: "Edited file", Icon: PencilSimpleIcon },
    str_replace: { label: "Edited file", Icon: PencilSimpleIcon },
    create_file: { label: "Created file", Icon: FileTextIcon },
    glob: { label: "Searched files", Icon: FolderOpenIcon },
    grep: { label: "Searched code", Icon: FileMagnifyingGlassIcon },
    web_search: { label: "Searched the web", Icon: MagnifyingGlassIcon },
    web_fetch: { label: "Fetched a page", Icon: GlobeIcon },
    run_subagent: { label: "Delegated to subagent", Icon: RobotIcon },
    memory_read: { label: "Read memory", Icon: BrainIcon },
    memory_create: { label: "Saved memory", Icon: BrainIcon },
  };
  if (exact[name]) return exact[name];

  // Prefix / keyword heuristics for MCP and third-party tools.
  if (name.startsWith("google_drive")) return { label: prettify(raw), Icon: GoogleDriveLogoIcon };
  if (name.includes("search")) return { label: prettify(raw), Icon: MagnifyingGlassIcon };
  if (name.includes("fetch") || name.includes("http")) return { label: prettify(raw), Icon: GlobeIcon };
  if (name.includes("mail") || name.includes("email")) return { label: prettify(raw), Icon: EnvelopeIcon };
  if (name.includes("download")) return { label: prettify(raw), Icon: CloudArrowDownIcon };
  if (name.includes("read") || name.includes("view") || name.includes("get")) return { label: prettify(raw), Icon: FileTextIcon };
  if (name.includes("write") || name.includes("edit") || name.includes("update")) return { label: prettify(raw), Icon: PencilSimpleIcon };
  if (name.includes("db") || name.includes("sql") || name.includes("query")) return { label: prettify(raw), Icon: DatabaseIcon };
  if (name.includes("memory")) return { label: prettify(raw), Icon: BrainIcon };
  if (name.includes("grep")) return { label: prettify(raw), Icon: FileMagnifyingGlassIcon };
  return { label: prettify(raw), Icon: WrenchIcon };
}

/** Turn a snake_case tool name into a readable "Sentence case" phrase. */
function prettify(name: string): string {
  const words = name.replace(/[._-]+/g, " ").trim().split(/\s+/);
  if (words.length === 0) return name;
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Collapsible row showing a single live tool invocation and its output. */
export function ToolCallCard({
  toolName,
  output,
  running,
  args,
  subagentSlug,
  subagentItems,
}: Props) {
  // Auto-expand while running so live work is visible; collapse once done,
  // unless the user has taken manual control of this row.
  const [open, setOpen] = useState(!!running);
  const userToggled = useRef(false);
  useEffect(() => {
    if (!userToggled.current) setOpen(!!running);
  }, [running]);

  const { label: baseLabel, Icon } = describeTool(toolName);
  const label = subagentSlug ? `${baseLabel} · ${subagentSlug}` : baseLabel;
  const preview = summarizeArgs(args);
  const inputs = argEntries(args);
  const hasInputs = inputs.length > 0;
  const hasOutput = output.trim().length > 0;
  const nested = subagentItems ?? [];
  const hasNested = nested.length > 0;
  const expandable = hasInputs || hasOutput || hasNested;

  return (
    <div className="group/tool overflow-hidden">
      <button
        type="button"
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
        disabled={!expandable}
        className={cn(
          "flex w-full items-center gap-2 py-1 text-left text-xs transition-colors",
          expandable ? "cursor-pointer hover:text-foreground" : "cursor-default",
          open ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            running
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          <Icon className="size-3" weight="bold" />
        </span>
        <span className="font-medium shrink-0">{label}</span>
        {preview ? (
          <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">
            {preview}
          </code>
        ) : null}
        {running ? (
          <Spinner className="size-3 text-muted-foreground" />
        ) : (
          <CheckIcon className="size-3 text-emerald-500" weight="bold" />
        )}
        {expandable ? (
          <CaretRightIcon
            className={cn(
              "ml-auto size-3 shrink-0 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
            weight="bold"
          />
        ) : null}
      </button>

      {open && expandable ? (
        <div className="ml-2.5 border-l border-border/60 pt-0.5 pb-1 pl-3.5">
          {hasInputs ? <ToolInputs entries={inputs} /> : null}
          {hasNested ? <SubagentActivity items={nested} /> : null}
          {hasOutput ? (
            <div className="mt-1.5">
              {hasInputs ? (
                <div className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                  Output
                </div>
              ) : null}
              <div className="group/out relative overflow-hidden rounded-md border border-border/60 bg-[var(--code-bg)]">
                <CopyButton
                  getText={() => output}
                  label="Copy output"
                  className="absolute top-1 right-1 z-10 opacity-0 transition-opacity group-hover/out:opacity-100"
                />
                <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
                  {output}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Renders a tool call's input args as labelled key/value rows. */
function ToolInputs({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([key, value]) => {
        const text =
          typeof value === "string" ? value : JSON.stringify(value, null, 2);
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
              {key}
            </span>
            <pre className="max-h-40 overflow-auto rounded-md border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
              {text}
            </pre>
          </div>
        );
      })}
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
              <span>{describeTool(item.toolName).label}</span>
              {item.done ? (
                <CheckIcon className="ml-auto size-3 text-emerald-500" weight="bold" />
              ) : (
                <Spinner className="ml-auto size-2.5" />
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
