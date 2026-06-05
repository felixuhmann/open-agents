import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Default agent / product mark. Uses `currentColor` so it follows the active
 * theme (`text-foreground` in light mode, light in dark mode).
 */
export function FallbackLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("shrink-0", className)}
      {...props}
    >
      {/* Broken outer ring — gaps at ~2 and ~8 o'clock */}
      <path
        d="M 89.4 37.2 A 42 42 0 1 0 19.8 78.8"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M 19.8 78.8 A 42 42 0 0 0 89.4 37.2"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Stylised "A" */}
      <path
        d="M 36 68 L 50 34 L 64 68"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 42 56 H 58"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Dot beneath the A */}
      <circle cx="50" cy="76" r="4.5" fill="currentColor" />
    </svg>
  );
}

/** Bundled email/static fallback served at `/static/fallback.png`. */
export const FALLBACK_AVATAR_URL = "/static/fallback.png";
