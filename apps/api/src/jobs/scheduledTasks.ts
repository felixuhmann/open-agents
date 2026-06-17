import type { Job } from "pg-boss";
import { prisma } from "../db.js";
import { log } from "../log.js";
import {
  enqueueScheduledTask,
  executeScheduledTaskRun,
  nextCronDate,
  syncScheduledTaskRunStatuses,
} from "../services/scheduledTasks.js";
import { getBoss } from "./queue.js";
import {
  JOB_RUN_SCHEDULED_TASK,
  JOB_SCHEDULED_TASK_DISPATCH,
  JOB_SCHEDULED_TASK_MONITOR,
  type RunScheduledTaskJobData,
  type ScheduledTaskDispatchJobData,
  type ScheduledTaskMonitorJobData,
} from "./types.js";

export const SCHEDULED_TASK_DISPATCH_CRON = "* * * * *";
export const SCHEDULED_TASK_MONITOR_CRON = "* * * * *";

export async function registerScheduledTaskWorkers(): Promise<void> {
  const boss = await getBoss();
  await boss.work<ScheduledTaskDispatchJobData>(
    JOB_SCHEDULED_TASK_DISPATCH,
    async (jobs) => {
      for (const job of jobs) await handleDispatch(job);
    },
  );
  await boss.work<RunScheduledTaskJobData>(JOB_RUN_SCHEDULED_TASK, async (jobs) => {
    for (const job of jobs) await executeScheduledTaskRun(job.data.scheduledTaskRunId);
  });
  await boss.work<ScheduledTaskMonitorJobData>(
    JOB_SCHEDULED_TASK_MONITOR,
    async (jobs) => {
      for (const job of jobs) await handleMonitor(job);
    },
  );
  await boss.schedule(JOB_SCHEDULED_TASK_DISPATCH, SCHEDULED_TASK_DISPATCH_CRON, {});
  await boss.schedule(JOB_SCHEDULED_TASK_MONITOR, SCHEDULED_TASK_MONITOR_CRON, {});
  log.info("worker registered", { queue: JOB_SCHEDULED_TASK_DISPATCH });
  log.info("worker registered", { queue: JOB_RUN_SCHEDULED_TASK });
  log.info("worker registered", { queue: JOB_SCHEDULED_TASK_MONITOR });
}

async function handleDispatch(_job: Job<ScheduledTaskDispatchJobData>): Promise<void> {
  const now = new Date();
  const due = await prisma.scheduledTask.findMany({
    where: { status: "active", nextRunAt: { lte: now } },
    take: 100,
  });
  for (const task of due) {
    try {
      await enqueueScheduledTask(task.id, task.nextRunAt ?? now);
      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: { lastRunAt: now, nextRunAt: nextCronDate(task.cron, now) },
      });
    } catch (err) {
      log.error("scheduled-task dispatch failed", {
        taskId: task.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function handleMonitor(_job: Job<ScheduledTaskMonitorJobData>): Promise<void> {
  await syncScheduledTaskRunStatuses();
}
