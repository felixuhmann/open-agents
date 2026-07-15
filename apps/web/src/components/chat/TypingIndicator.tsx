/** Visible activity label plus animation shown while an agent run is active. */
export function TypingIndicator({ label = "Working…" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span>{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70" />
      </span>
    </div>
  );
}
