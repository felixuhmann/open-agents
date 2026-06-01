export function serializeToolResultForModel(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    return "[unserializable tool result]";
  }
}
