import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";
import type { HydratedAgent } from "../agents/service.js";
import { resolveRuntimeSubagents, type VersionedAgent } from "../agents/snapshot.js";
import type { AgentRunContext } from "../agent-backend/types.js";
import { MAX_TOOL_OUTPUT_CHARS, truncateText } from "../services/daytonaLimits.js";

/**
 * Runtime context needed to execute a `run_subagent` call: which run is
 * delegating and where it sits in the delegation tree (for the depth + cycle
 * guards enforced by `runSubagent`).
 */
export type SubagentToolRuntime = {
  /** Parent AgentRun id. Absent for non-persisted (draft) invocations. */
  parentRunId?: string;
  parentSurface: AgentRunContext["surface"];
  /** Delegation depth of the caller (0 for a user-facing run). */
  depth: number;
  /** Agent ids from the delegation root down to the caller, inclusive. */
  ancestors: string[];
};

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: { isError: true }, isError: true };
}

/**
 * Build the `run_subagent` tool for an agent that has one or more subagent
 * bindings. Returns an empty array when the agent delegates to no one, so
 * agents without subagents pay nothing.
 */
export function buildSubagentPiTools(
  agent: HydratedAgent | VersionedAgent,
  runtime: SubagentToolRuntime,
): AgentTool[] {
  const subagents = resolveRuntimeSubagents(agent);
  if (subagents.length === 0) return [];

  const bySlug = new Map(subagents.map((s) => [s.slug, s]));
  const slugs = subagents.map((s) => s.slug);
  const roster = subagents
    .map((s) => `- ${s.slug}: ${s.displayName}${s.description ? ` — ${s.description}` : ""}`)
    .join("\n");

  // A closed enum of allowed slugs so the model can only target bound agents.
  const subagentParam =
    slugs.length === 1
      ? Type.Literal(slugs[0]!)
      : Type.Union(slugs.map((slug) => Type.Literal(slug)));

  const tool: AgentTool = {
    name: "run_subagent",
    label: "Run subagent",
    description:
      "Delegate a self-contained task to one of your subagents and receive its final text back. " +
      "The subagent runs in a fresh, isolated workspace with NO access to this conversation — " +
      "include everything it needs in `prompt`. Use this to hand specialized work to a purpose-built " +
      "agent instead of doing it yourself. Available subagents:\n" +
      roster,
    parameters: Type.Object({
      subagent: subagentParam,
      prompt: Type.String({
        description:
          "The complete task and all context the subagent needs. It sees only this text.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_id: string, params: Static<TSchema>) => {
      const p = params as { subagent: string; prompt: string };
      const callee = bySlug.get(p.subagent);
      if (!callee) {
        return errorResult(
          `Unknown subagent "${p.subagent}". Available: ${slugs.join(", ")}.`,
        );
      }
      if (!runtime.parentRunId) {
        return errorResult("Subagent delegation is only available inside a persisted run.");
      }

      // Deferred import breaks the daytona <-> runStream module cycle.
      const { runSubagent } = await import("../services/subagentRunner.js");
      const result = await runSubagent({
        parent: {
          runId: runtime.parentRunId,
          surface: runtime.parentSurface,
          depth: runtime.depth,
          ancestors: runtime.ancestors,
        },
        callee: {
          subagentId: callee.subagentId,
          slug: callee.slug,
          displayName: callee.displayName,
          agentVersionId: callee.agentVersionId,
        },
        prompt: p.prompt,
      });

      if (!result.ok) {
        return errorResult(result.error ?? "Subagent call failed.");
      }
      const raw =
        result.output && result.output.trim().length > 0
          ? result.output
          : "(The subagent produced no textual output.)";
      const text = truncateText(raw, MAX_TOOL_OUTPUT_CHARS).text;
      return {
        content: [{ type: "text" as const, text }],
        details: { isError: false, subagent: callee.slug, runId: result.runId },
      };
    },
  };

  return [tool];
}
