import type { ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const COMPONENTS: Components = {
  p: ({ className, ...props }) => (
    <p className={cn("my-2 first:mt-0 last:mb-0", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn("underline underline-offset-2 hover:opacity-80", className)}
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold", className)} {...props} />
  ),
  em: ({ className, ...props }) => <em className={cn("italic", className)} {...props} />,
  ul: ({ className, ...props }) => (
    <ul
      className={cn("my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn("my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("[&>p]:my-0", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "my-2 border-l-2 border-current/30 pl-3 italic opacity-90 first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "mt-3 mb-2 font-heading text-base font-semibold first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "mt-3 mb-2 font-heading text-base font-semibold first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "mt-3 mb-1.5 font-heading text-sm font-semibold first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "mt-3 mb-1.5 font-heading text-sm font-semibold first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("my-3 border-current/20", className)} {...props} />
  ),
  code: ({ className, children, ...props }: ComponentProps<"code">) => {
    const isBlock = /\blanguage-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={cn("font-mono text-[0.85em]", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className={cn(
          "rounded bg-current/10 px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-2 overflow-x-auto border border-current/15 bg-current/5 p-3 text-xs leading-relaxed first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className={cn("w-full border-collapse text-xs", className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }) => (
    <thead className={cn("border-b border-current/20", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border border-current/15 px-2 py-1 text-left font-semibold",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn("border border-current/15 px-2 py-1 align-top", className)}
      {...props}
    />
  ),
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
