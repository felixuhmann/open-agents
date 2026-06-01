import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  /** Lazily resolves the text to copy (lets callers read from a DOM ref). */
  getText: () => string | null | undefined;
  className?: string;
  label?: string;
};

/**
 * Small "copy to clipboard" affordance shared by code blocks and assistant
 * messages. Shows a transient check mark on success.
 */
export function CopyButton({ getText, className, label = "Copy" }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onClick = () => {
    const text = getText();
    if (!text) return;
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={onClick}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? (
        <CheckIcon className="size-3 text-emerald-500" weight="bold" />
      ) : (
        <CopyIcon className="size-3" />
      )}
    </Button>
  );
}
