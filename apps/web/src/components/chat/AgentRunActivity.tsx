import { AiChatPendingMessage, AiToolCall } from "./AiChat";
import type { AgentRunStreamState } from "./useAgentRunStream";

export function AgentRunActivity({
  state,
  running,
}: {
  state: AgentRunStreamState;
  running: boolean;
}) {
  const waiting = running && !state.text && state.toolCalls.length === 0;
  if (!state.text && !state.reasoning && state.toolCalls.length === 0 && !waiting) {
    return null;
  }

  return (
    <AiChatPendingMessage
      text={state.text}
      reasoning={state.reasoning}
      waiting={waiting}
      tools={
        state.toolCalls.length > 0 ? (
          <div className="flex flex-col gap-2">
            {state.toolCalls.map((tool) => (
              <AiToolCall
                key={tool.callId}
                toolName={tool.toolName}
                output={tool.output}
                running={!tool.done}
                args={tool.args}
                isError={tool.isError}
                subagentSlug={tool.subagentSlug}
                subagentItems={tool.subagentItems}
              />
            ))}
          </div>
        ) : null
      }
    />
  );
}
