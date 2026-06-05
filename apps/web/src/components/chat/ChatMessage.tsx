import type { ReactNode } from "react";
import { PaperclipIcon } from "@phosphor-icons/react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Markdown } from "@/components/Markdown";
import { CopyButton } from "@/components/chat/CopyButton";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { formatBytes, formatTime } from "@/components/chat/utils";
import { type ChatAttachmentSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type ChatMessageRole = "user" | "assistant" | "system";

type Props = {
  role: ChatMessageRole;
  content: string;
  createdAt?: string;
  attachments?: ChatAttachmentSummary[];
  agentDisplayName: string;
  agentAvatar: string | null;
  /** True while this assistant message is still streaming. */
  pending?: boolean;
  /** Downstream slot, e.g. agent-produced run attachments. */
  footer?: ReactNode;
};

export function ChatMessage({
  role,
  content,
  createdAt,
  attachments,
  agentDisplayName,
  agentAvatar,
  pending,
  footer,
}: Props) {
  if (role === "system") {
    return (
      <div className="flex justify-center px-2 py-1">
        <p className="max-w-2xl text-center text-xs whitespace-pre-wrap text-muted-foreground italic">
          {content}
        </p>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="group/msg flex flex-col items-end gap-1.5">
        {content ? (
          <div className="max-w-[85%] border border-border bg-secondary px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-secondary-foreground">
            {content}
          </div>
        ) : null}
        <AttachmentChips attachments={attachments} />
        <MessageMeta
          createdAt={createdAt}
          copyText={content}
          className="opacity-0 group-hover/msg:opacity-100"
        />
      </div>
    );
  }

  return (
    <div className="group/msg flex w-full items-start gap-3">
      <AgentAvatar
        avatar={agentAvatar}
        displayName={agentDisplayName}
        className="mt-0.5 size-7 shrink-0 border border-border"
        logoClassName="size-[62%]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
        <span className="text-xs font-medium text-muted-foreground">
          {agentDisplayName}
        </span>
        {content ? <Markdown>{content}</Markdown> : pending ? <TypingIndicator /> : null}
        {footer}
        {!pending && content ? (
          <MessageMeta
            createdAt={createdAt}
            copyText={content}
            className="opacity-0 group-hover/msg:opacity-100"
          />
        ) : null}
      </div>
    </div>
  );
}

function MessageMeta({
  createdAt,
  copyText,
  className,
}: {
  createdAt?: string;
  copyText: string;
  className?: string;
}) {
  const time = createdAt ? formatTime(createdAt) : "";
  return (
    <div
      className={cn(
        "flex items-center gap-1 text-[10px] text-muted-foreground transition-opacity focus-within:opacity-100",
        className,
      )}
    >
      <CopyButton getText={() => copyText} label="Copy message" />
      {time ? <span className="tabular-nums">{time}</span> : null}
    </div>
  );
}

function AttachmentChips({ attachments }: { attachments?: ChatAttachmentSummary[] }) {
  const items = attachments ?? [];
  if (items.length === 0) return null;
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {items.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1.5 border border-border bg-card px-2 py-1 text-xs"
        >
          <PaperclipIcon className="size-3 shrink-0" />
          <span className="max-w-[14rem] truncate" title={a.filename}>
            {a.filename}
          </span>
          <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
        </span>
      ))}
    </div>
  );
}
