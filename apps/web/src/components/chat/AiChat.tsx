import { CheckIcon, CopyIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import type { FileUIPart, UIMessage } from "ai";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  type AttachmentData,
} from "@/components/ai-elements/attachments";
import {
  ConversationDownload,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuGroup } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { DEFAULT_STARTER_PROMPTS } from "@/components/chat/defaultStarterPrompts";
import { formatBytes, formatTime } from "@/components/chat/utils";
import { cn } from "@/lib/utils";

export type PendingUpload = {
  chatAttachmentId: string;
  chatMessageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type ChatAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type SubagentItem =
  | { type: "tool"; callId: string; toolName: string; output: string; done: boolean }
  | { type: "message"; text: string; isError?: boolean };

function toAttachmentData(file: ChatAttachment | PendingUpload): AttachmentData {
  return {
    id: "id" in file ? file.id : file.chatAttachmentId,
    type: "file",
    filename: file.filename,
    mediaType: file.contentType,
    url: "",
  };
}

function MessageAttachments({
  attachments,
  align = "start",
}: {
  attachments?: ChatAttachment[];
  align?: "start" | "end";
}) {
  if (!attachments?.length) return null;

  return (
    <Attachments
      variant="inline"
      className={cn("max-w-full", align === "end" && "ml-auto justify-end")}
    >
      {attachments.map((attachment) => (
        <Attachment key={attachment.id} data={toAttachmentData(attachment)}>
          <AttachmentPreview />
          <AttachmentInfo />
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(attachment.sizeBytes)}
          </span>
        </Attachment>
      ))}
    </Attachments>
  );
}

function CopyMessageAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error("Couldn’t copy this message");
    }
  };

  return (
    <MessageAction
      label={copied ? "Copied" : "Copy message"}
      tooltip={copied ? "Copied" : "Copy"}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </MessageAction>
  );
}

export function AiChatMessage({
  role,
  content,
  createdAt,
  attachments,
  footer,
  isAnimating = false,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  attachments?: ChatAttachment[];
  footer?: ReactNode;
  isAnimating?: boolean;
}) {
  if (role === "system") {
    return (
      <Message from="system" className="mx-auto items-center">
        <MessageContent className="w-fit text-center text-xs text-muted-foreground italic">
          <MessageResponse>{content}</MessageResponse>
        </MessageContent>
      </Message>
    );
  }

  const time = createdAt ? formatTime(createdAt) : null;

  return (
    <Message from={role}>
      <MessageContent className={cn(role === "assistant" && "w-full")}>
        {content ? (
          <MessageResponse isAnimating={isAnimating}>{content}</MessageResponse>
        ) : null}
        <MessageAttachments
          attachments={attachments}
          align={role === "user" ? "end" : "start"}
        />
        {footer}
      </MessageContent>
      {content ? (
        <MessageActions
          className={cn(
            "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
            role === "user" && "justify-end",
          )}
        >
          <CopyMessageAction text={content} />
          {time ? (
            <span className="px-1 text-xs tabular-nums text-muted-foreground">
              {time}
            </span>
          ) : null}
        </MessageActions>
      ) : null}
    </Message>
  );
}

export function AiChatPendingMessage({
  text,
  reasoning,
  waiting,
  tools,
}: {
  text?: string;
  reasoning?: boolean;
  waiting?: boolean;
  tools?: ReactNode;
}) {
  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {reasoning ? (
          <Reasoning isStreaming>
            <ReasoningTrigger
              getThinkingMessage={() => <Shimmer duration={1}>Reasoning…</Shimmer>}
            />
          </Reasoning>
        ) : null}
        {tools}
        {text ? <MessageResponse isAnimating>{text}</MessageResponse> : null}
        {waiting && !reasoning && !text && !tools ? (
          <Shimmer duration={1}>Working…</Shimmer>
        ) : null}
      </MessageContent>
    </Message>
  );
}

export function AiChatEmptyState({
  displayName,
  avatar,
  starterPrompts,
  onPick,
}: {
  displayName: string;
  avatar: string | null;
  starterPrompts?: string[];
  onPick: (prompt: string) => void;
}) {
  const prompts = starterPrompts?.length ? starterPrompts : DEFAULT_STARTER_PROMPTS;

  return (
    <ConversationEmptyState className="min-h-[55vh] px-3">
      <AgentAvatar
        avatar={avatar}
        displayName={displayName}
        className="size-12 border border-border"
      />
      <div className="flex max-w-xl flex-col gap-1 text-center">
        <h2 className="font-heading text-lg font-semibold">Chat with {displayName}</h2>
        <p className="text-sm text-muted-foreground">
          Ask a question, share a file, or start with one of these prompts.
        </p>
      </div>
      <Suggestions className="max-w-full justify-center py-2">
        {prompts.map((prompt) => (
          <Suggestion key={prompt} suggestion={prompt} onClick={onPick} />
        ))}
      </Suggestions>
    </ConversationEmptyState>
  );
}

export function AiConversationDownload({
  messages,
  filename,
}: {
  messages: Array<{ id: string; role: UIMessage["role"]; content: string }>;
  filename: string;
}) {
  const uiMessages: UIMessage[] = messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.content, state: "done" }],
  }));

  if (!uiMessages.length) return null;

  return (
    <ConversationDownload
      messages={uiMessages}
      filename={filename}
      aria-label="Download conversation"
      title="Download conversation"
    />
  );
}

function PromptAttachmentUploads({
  pendingUploads,
  onRemoveUpload,
  onFiles,
  uploadingCount,
  sending,
}: {
  pendingUploads: PendingUpload[];
  onRemoveUpload: (upload: PendingUpload) => void;
  onFiles: (files: File[]) => void | Promise<void>;
  uploadingCount: number;
  sending: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const processed = useRef(new Set<string>());

  useEffect(() => {
    for (const part of attachments.files) {
      if (processed.current.has(part.id)) continue;
      processed.current.add(part.id);
      void (async () => {
        try {
          const response = await fetch(part.url);
          const blob = await response.blob();
          const file = new File([blob], part.filename ?? "attachment", {
            type: part.mediaType || blob.type,
          });
          await onFiles([file]);
        } catch (error) {
          toast.error(`${part.filename ?? "Attachment"}: couldn’t prepare upload`, {
            description: error instanceof Error ? error.message : String(error),
          });
        } finally {
          attachments.remove(part.id);
        }
      })();
    }
  }, [attachments, onFiles]);

  if (!pendingUploads.length && !attachments.files.length && uploadingCount === 0) {
    return null;
  }

  return (
    <Attachments variant="inline" className="w-full">
      {pendingUploads.map((upload) => (
        <Attachment
          key={upload.chatAttachmentId}
          data={toAttachmentData(upload)}
          onRemove={sending ? undefined : () => onRemoveUpload(upload)}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(upload.sizeBytes)}
          </span>
          <AttachmentRemove label={`Remove ${upload.filename}`} />
        </Attachment>
      ))}
      {attachments.files.map((file: FileUIPart & { id: string }) => (
        <Attachment key={file.id} data={file}>
          <AttachmentPreview />
          <AttachmentInfo />
          <Spinner />
        </Attachment>
      ))}
      {uploadingCount > 0 ? (
        <Badge variant="outline">
          <Spinner data-icon="inline-start" />
          Uploading {uploadingCount}…
        </Badge>
      ) : null}
    </Attachments>
  );
}

function PromptSubmitState({
  canSend,
  sending,
  running,
  stopping,
  onStop,
}: {
  canSend: boolean;
  sending: boolean;
  running: boolean;
  stopping: boolean;
  onStop?: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const filesAreStaged = attachments.files.length === 0;

  return (
    <PromptInputSubmit
      disabled={running ? stopping : !canSend || !filesAreStaged}
      status={running && !stopping ? "streaming" : sending ? "submitted" : "ready"}
      onStop={running && !stopping ? onStop : undefined}
    />
  );
}

export function AiChatComposer({
  value,
  onChange,
  onSubmit,
  onFiles,
  pendingUploads,
  onRemoveUpload,
  uploadingCount,
  sending,
  running = false,
  stopping = false,
  onStop,
  placeholder = "Send a message…",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFiles: (files: File[]) => void | Promise<void>;
  pendingUploads: PendingUpload[];
  onRemoveUpload: (upload: PendingUpload) => void;
  uploadingCount: number;
  sending: boolean;
  running?: boolean;
  stopping?: boolean;
  onStop?: () => void;
  placeholder?: string;
}) {
  const canSend =
    !sending &&
    uploadingCount === 0 &&
    (value.trim().length > 0 || pendingUploads.length > 0);

  return (
    <PromptInput
      globalDrop={!sending}
      multiple
      maxFileSize={25 * 1024 * 1024}
      onError={(error) => toast.error(error.message)}
      onSubmit={() => {
        if (canSend) onSubmit();
      }}
    >
      <PromptInputHeader>
        <PromptAttachmentUploads
          pendingUploads={pendingUploads}
          onRemoveUpload={onRemoveUpload}
          onFiles={onFiles}
          uploadingCount={uploadingCount}
          sending={sending}
        />
      </PromptInputHeader>
      <PromptInputBody>
        <PromptInputTextarea
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={placeholder}
          disabled={sending}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger
              aria-label="Add attachment"
              disabled={sending || uploadingCount > 0}
            />
            <PromptInputActionMenuContent>
              <DropdownMenuGroup>
                <PromptInputActionAddAttachments
                  disabled={sending || uploadingCount > 0}
                />
                <PromptInputActionAddScreenshot
                  disabled={sending || uploadingCount > 0}
                />
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Enter to send · Shift+Enter for a new line
          </span>
        </PromptInputTools>
        <PromptSubmitState
          canSend={canSend}
          sending={sending}
          running={running}
          stopping={stopping}
          onStop={onStop}
        />
      </PromptInputFooter>
    </PromptInput>
  );
}

function toolTitle(toolName: string): string {
  return toolName
    .replace(/^mcp__/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AiToolCall({
  toolName,
  output,
  running = false,
  args,
  isError = false,
  subagentSlug,
  subagentItems,
}: {
  toolName: string;
  output: string;
  running?: boolean;
  args?: Record<string, unknown>;
  isError?: boolean;
  subagentSlug?: string;
  subagentItems?: SubagentItem[];
}) {
  const [open, setOpen] = useState(running);

  useEffect(() => {
    setOpen(running);
  }, [running]);

  const state = running
    ? ("input-available" as const)
    : isError
      ? ("output-error" as const)
      : ("output-available" as const);

  return (
    <Tool open={open} onOpenChange={setOpen}>
      <ToolHeader
        type="dynamic-tool"
        toolName={toolName}
        title={subagentSlug ? `Subagent: ${subagentSlug}` : toolTitle(toolName)}
        state={state}
      />
      <ToolContent>
        {args && Object.keys(args).length > 0 ? <ToolInput input={args} /> : null}
        <ToolOutput
          output={!isError && output ? output : undefined}
          errorText={isError ? output || "The tool failed." : undefined}
        />
        {subagentItems?.length ? (
          <div className="flex flex-col gap-2">
            {subagentItems.map((item, index) =>
              item.type === "tool" ? (
                <AiToolCall
                  key={item.callId}
                  toolName={item.toolName}
                  output={item.output}
                  running={!item.done}
                />
              ) : (
                <div
                  key={`${index}-${item.text.slice(0, 24)}`}
                  className={cn("text-sm", item.isError && "text-destructive")}
                >
                  <MessageResponse>{item.text}</MessageResponse>
                </div>
              ),
            )}
          </div>
        ) : null}
      </ToolContent>
    </Tool>
  );
}

export function AiRunAttachments({
  attachments,
}: {
  attachments: Array<ChatAttachment & { href: string }>;
}) {
  if (!attachments.length) return null;

  return (
    <Attachments variant="list" className="mt-3">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          href={attachment.href}
          download={attachment.filename}
          className="w-full"
        >
          <Attachment data={toAttachmentData(attachment)}>
            <AttachmentPreview />
            <AttachmentInfo showMediaType />
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(attachment.sizeBytes)}
            </span>
            <DownloadSimpleIcon aria-hidden />
          </Attachment>
        </a>
      ))}
    </Attachments>
  );
}
