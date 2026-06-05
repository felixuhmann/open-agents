import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DEFAULT_STARTER_PROMPTS } from "./defaultStarterPrompts.js";

type Props = {
  agentDisplayName: string;
  agentAvatar: string | null;
  /** Agent-configured prompts; falls back to {@link DEFAULT_STARTER_PROMPTS} when empty. */
  starterPrompts?: string[];
  onPick: (text: string) => void;
};

export function ChatEmptyState({
  agentDisplayName,
  agentAvatar,
  starterPrompts,
  onPick,
}: Props) {
  const suggestions =
    starterPrompts && starterPrompts.length > 0
      ? starterPrompts
      : DEFAULT_STARTER_PROMPTS;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <AgentAvatar
        avatar={agentAvatar}
        displayName={agentDisplayName}
        className="size-14 border border-border"
      />
      <div className="space-y-1.5">
        <h2 className="font-heading text-lg font-semibold">{agentDisplayName}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Ask a question, paste some context, or drag and drop a file to get started.
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="group flex items-center justify-between gap-2 border border-border bg-card px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted/60"
          >
            <span>{s}</span>
            <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}
