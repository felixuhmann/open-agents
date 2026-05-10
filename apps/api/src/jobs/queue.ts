import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { log } from "../log.js";
import { JOB_RUN_AGENT, JOB_SEND_EMAIL } from "./types.js";

let boss: PgBoss | null = null;

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
  await instance.createQueue(JOB_RUN_AGENT);
  await instance.createQueue(JOB_SEND_EMAIL);
  boss = instance;
  log.info("pg-boss started", { queues: [JOB_RUN_AGENT, JOB_SEND_EMAIL] });
  return instance;
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true });
  boss = null;
}
