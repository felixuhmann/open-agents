/** Incremental token chunks duplicated by agent.message / step output nodes. */
export const DEBUG_TRACE_OMITTED_DELTA_TYPES = new Set([
  "agent.delta",
  "workflow.step.delta",
]);

export function isDebugTraceDeltaEvent(type: string): boolean {
  return DEBUG_TRACE_OMITTED_DELTA_TYPES.has(type);
}

export function filterDebugTraceEvents<T extends { type: string }>(events: T[]): T[] {
  return events.filter((event) => !isDebugTraceDeltaEvent(event.type));
}
