import { StarterPromptsSchema } from "@open-agents/types";

/** Normalize stored JSON into validated starter prompt strings. */
export function parseStarterPrompts(value: unknown): string[] {
  const parsed = StarterPromptsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
