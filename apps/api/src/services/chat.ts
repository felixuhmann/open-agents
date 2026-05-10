import { prisma } from "../db.js";
import { getBoss } from "../jobs/queue.js";
import { JOB_RUN_AGENT, type RunAgentJobData } from "../jobs/types.js";

export type EnqueueChatTurnArgs = {
  conversationId: string;
  userMessageId: string;
};

/**
 * Persist a placeholder AgentRun row and enqueue the run-agent job for a
 * chat turn. Returns the new runId so the SSE handler has something to
 * subscribe to immediately.
 */
export async function enqueueChatTurn(args: EnqueueChatTurnArgs): Promise<string> {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: args.conversationId },
  });
  if (!conversation) {
    throw new Error(`Conversation not found: ${args.conversationId}`);
  }

  const run = await prisma.agentRun.create({
    data: {
      agentId: conversation.agentId,
      conversationId: conversation.id,
      surface: "chat",
      sessionId: conversation.anthropicSessionId ?? "",
      status: "pending",
    },
  });

  await prisma.chatMessage.update({
    where: { id: args.userMessageId },
    data: { runId: run.id },
  });

  const boss = await getBoss();
  const data: RunAgentJobData = {
    runId: run.id,
    surface: "chat",
    chatMessageId: args.userMessageId,
  };
  await boss.send(JOB_RUN_AGENT, data);

  return run.id;
}
