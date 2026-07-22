import type { HydratedAgent } from "../agents/service.js";
import {
  skillSandboxRootFor,
  skillSlugFromName,
} from "../services/skillSandboxPaths.js";

/**
 * Runtime system prompt for the shared Pi loop.
 *
 * Deliberately provider-neutral: the model is told it has a Linux sandbox,
 * not which vendor supplies it. Naming the provider would leak deployment
 * configuration into frozen conversation context and make the same agent
 * behave differently after a provider switch.
 */

export function buildSkillInstructions(
  agent: Pick<HydratedAgent, "skillBindings">,
  skillsRoot: string,
): string | null {
  if (!agent.skillBindings.length) return null;
  const lines = agent.skillBindings.map((binding) => {
    const slug = skillSlugFromName(binding.skill.name);
    return `- ${binding.skill.name} (pinned v${binding.skillVersion.versionNumber}): ${skillsRoot}/${slug}/SKILL.md`;
  });
  return [
    `Bundled skills are unpacked under ${skillsRoot}/<slug>/ in this sandbox.`,
    "When a task matches a skill, read that skill's SKILL.md before using other files in the same directory.",
    "Skills bound to this agent:",
    ...lines,
  ].join("\n");
}

export type RuntimePromptInput = {
  agent: Pick<HydratedAgent, "systemPrompt" | "skillBindings">;
  hasTools: boolean;
  providerSandboxId: string;
  workspaceDir: string;
};

export function buildRuntimePrompt(input: RuntimePromptInput): string {
  const { agent, hasTools, providerSandboxId, workspaceDir } = input;

  const toolInstructions = hasTools
    ? [
        `You have a Linux sandbox workspace. Treat ${workspaceDir} as the working directory.`,
        `Uploaded files are available under ${workspaceDir}/inbox. If older prompts or skills mention /workspace, interpret that prefix as ${workspaceDir}.`,
        "Use tools to inspect files, write artifacts, and run commands when useful.",
        "Bash uses a persistent shell session in the sandbox (cwd and env persist between calls).",
        "For web pages or search, use curl/wget in bash or bind a third-party MCP search tool — there is no built-in web_search.",
        "Platform tools (for example memory_*) and third-party MCP tools (name prefix server:tool) run on the orchestrator host, not inside the sandbox.",
        "When the user needs a downloadable file, call attach_run_file with the sandbox path.",
      ].join("\n")
    : "No sandbox tools are currently enabled for this agent.";

  const skillInstructions = buildSkillInstructions(
    agent,
    skillSandboxRootFor(workspaceDir),
  );

  const sections = [
    agent.systemPrompt.trim(),
    toolInstructions,
    skillInstructions,
    `Sandbox id: ${providerSandboxId}`,
  ].filter(Boolean);

  return sections.join("\n\n");
}
