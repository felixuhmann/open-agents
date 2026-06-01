/** Three-dot "agent is thinking" animation shown before the first token. */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Agent is thinking">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70" />
    </div>
  );
}
