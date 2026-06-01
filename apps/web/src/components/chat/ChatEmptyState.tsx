import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarSrc } from "@/lib/queries";

const SUGGESTIONS = [
  "What can you help me with?",
  "Summarize a document I'll paste",
  "Draft an email for me",
  "Walk me through your tools",
];

type Props = {
  agentDisplayName: string;
  agentAvatar: string | null;
  agentInitials: string;
  onPick: (text: string) => void;
};

export function ChatEmptyState({
  agentDisplayName,
  agentAvatar,
  agentInitials,
  onPick,
}: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <Avatar className="size-14 border border-border">
        {agentAvatar ? (
          <AvatarImage src={avatarSrc(agentAvatar)} alt={agentDisplayName} />
        ) : null}
        <AvatarFallback className="bg-primary text-base text-primary-foreground">
          {agentInitials}
        </AvatarFallback>
      </Avatar>
      <div className="space-y-1.5">
        <h2 className="font-heading text-lg font-semibold">{agentDisplayName}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Ask a question, paste some context, or attach a file to get started.
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
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
