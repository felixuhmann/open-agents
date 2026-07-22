import { posix as path } from "node:path";

import { shellQuote } from "../../services/sandboxShell.js";

/**
 * Workspace helpers for the broker adapter.
 *
 * The broker's file API is deliberately minimal — read, write, delete — so
 * directory creation and globbing are expressed as sandbox commands here
 * rather than as extra endpoints there.
 */

/** `find` prints one path per line; it also emits nothing for an empty tree. */
export const MAX_SEARCH_RESULTS = 5_000;

export function findCommand(root: string): string {
  return `find ${shellQuote(root)} -type f -not -path '*/.git/*' -print 2>/dev/null | head -n ${MAX_SEARCH_RESULTS}`;
}

export function makeDirCommand(target: string): string {
  return `mkdir -p ${shellQuote(target)}`;
}

/**
 * Translate a glob to a `RegExp`.
 *
 * `find -name/-path` cannot express `**` the way callers expect, so the
 * listing is filtered here instead. `**` crosses directory separators, `*`
 * and `?` do not.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` should also match zero directories, so the slash is optional.
        if (pattern[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/**
 * Filter a `find` listing by glob. The pattern is matched against the path
 * relative to `root` and against the absolute path, so both `**\/*.ts` and
 * `/workspace/**\/*.ts` behave as a caller would expect.
 */
export function filterByGlob(listing: string, root: string, pattern: string): string[] {
  const matcher = globToRegExp(pattern);
  const rootPrefix = root.endsWith("/") ? root : `${root}/`;
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((absolute) => {
      if (matcher.test(absolute)) return true;
      const relative = absolute.startsWith(rootPrefix)
        ? absolute.slice(rootPrefix.length)
        : path.relative(root, absolute);
      return matcher.test(relative);
    });
}
