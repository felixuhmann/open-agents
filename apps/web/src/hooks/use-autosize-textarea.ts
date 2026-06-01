import { useLayoutEffect, type RefObject } from "react";

/** Matches Tailwind `max-h-56` (14rem). */
export const CHAT_COMPOSER_MAX_HEIGHT_PX = 224;

/**
 * Grows a textarea with its content up to `maxHeightPx`, then scrolls.
 * Resets height when `value` is cleared (e.g. after send).
 */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx = CHAT_COMPOSER_MAX_HEIGHT_PX,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden";
  }, [ref, value, maxHeightPx]);
}
