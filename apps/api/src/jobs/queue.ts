import type { QueueOptions } from "pg-boss";
import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { log } from "../log.js";
import {
  JOB_RUN_AGENT,
  JOB_RUN_WORKFLOW,
  JOB_SANDBOX_RECONCILE,
  JOB_SEND_EMAIL,
  JOB_SCHEDULED_TASK_DISPATCH,
  JOB_RUN_SCHEDULED_TASK,
  JOB_SCHEDULED_TASK_MONITOR,
} from "./types.js";

let boss: PgBoss | null = null;

const RUN_AGENT_QUEUE_POLICY = "singleton" as const;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const instance = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: "pgboss",
  });
  instance.on("error", (err: unknown) =>
    log.error("pg-boss error", { err: String(err) }),
  );
  await instance.start();
  // Each chat/email send supplies a conversation-scoped singletonKey. This
  // permits many conversations in parallel while preventing two turns from
  // racing the same durable Pi checkpoint. Unlike strict FIFO, a permanently
  // failed job does not block every later message in that conversation.
  const runAgentQueueOptions: QueueOptions = {
    expireInSeconds: config.AGENT_STALE_RUN_SECONDS + 5 * 60,
    heartbeatSeconds: 60,
  };
  await instance.createQueue(JOB_RUN_AGENT, {
    ...runAgentQueueOptions,
    policy: RUN_AGENT_QUEUE_POLICY,
  });
  const runAgentQueue = await instance.getQueue(JOB_RUN_AGENT);
  if (runAgentQueue?.policy !== RUN_AGENT_QUEUE_POLICY) {
    throw new Error(
      `${JOB_RUN_AGENT} queue has unexpected policy ${runAgentQueue?.policy ?? "missing"}`,
    );
  }
  // `createQueue` is a no-op for an existing queue, so apply timing changes
  // explicitly during every boot as well. Policy is intentionally excluded:
  // pg-boss rejects policy changes through `updateQueue`.
  await instance.updateQueue(JOB_RUN_AGENT, runAgentQueueOptions);
  await instance.createQueue(JOB_RUN_WORKFLOW);
  await instance.createQueue(JOB_SEND_EMAIL);
  await instance.createQueue(JOB_SANDBOX_RECONCILE);
  await instance.createQueue(JOB_SCHEDULED_TASK_DISPATCH);
  await instance.createQueue(JOB_RUN_SCHEDULED_TASK);
  await instance.createQueue(JOB_SCHEDULED_TASK_MONITOR);
  boss = instance;
  log.info("pg-boss started", {
    queues: [
      JOB_RUN_AGENT,
      JOB_RUN_WORKFLOW,
      JOB_SEND_EMAIL,
      JOB_SANDBOX_RECONCILE,
      JOB_SCHEDULED_TASK_DISPATCH,
      JOB_RUN_SCHEDULED_TASK,
      JOB_SCHEDULED_TASK_MONITOR,
    ],
  });
  return instance;
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true });
  boss = null;
}
