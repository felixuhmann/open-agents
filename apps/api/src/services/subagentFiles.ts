import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

/**
 * Shared "file tray" directory that ties a delegation tree together. Every
 * subagent sandbox is seeded with the parent run's attachments here, and
 * every file a subagent attaches is materialized back into the parent
 * sandbox at the same path. Uses the conventional `/workspace` prefix, which
 * the sandbox tools remap to the real working directory.
 */
export const SUBAGENT_TRAY_DIR = "/workspace/subagent_files";

export type MaterializedFile = {
  filename: string;
  /** Logical path inside the parent sandbox (remapped by the sandbox tools). */
  path: string;
  contentType: string;
  sizeBytes: number;
};

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment";
}

function trayPath(filename: string): string {
  return `${SUBAGENT_TRAY_DIR}/${safeFilename(filename)}`;
}

/**
 * Build mountable `SessionResource`s from a run's attachments so they can be
 * seeded into another sandbox at the shared tray path. Returns an empty array
 * when the run has no attachments.
 */
export async function loadRunFileResources(runId: string): Promise<SessionResource[]> {
  const rows = await prisma.agentAttachment.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    type: "file" as const,
    fileId: row.id,
    filename: row.filename,
    mime: row.contentType,
    mountPath: trayPath(row.filename),
    bytes: new Uint8Array(row.bytes),
  }));
}

/**
 * After a subagent run completes, place the files it produced into the parent
 * sandbox at the shared tray path so the orchestrator can read, reprocess, or
 * forward them to another subagent.
 *
 * It deliberately does NOT create parent-run attachments: whether any file is
 * surfaced to the user is the orchestrator's decision alone, made by calling
 * its own `attach_run_file` on a tray path. Intermediate subagent artifacts
 * stay invisible in chat unless the orchestrator chooses to attach them.
 *
 * Best-effort: if the mount fails nothing lands in the tray, so we return an
 * empty list (no paths advertised to the model) rather than failing the run.
 */
export async function materializeSubagentFiles(input: {
  childRunId: string;
  parentRunId: string;
  parentSessionId: string;
  slug: string;
}): Promise<MaterializedFile[]> {
  const { childRunId, parentRunId, parentSessionId, slug } = input;

  const childRows = await prisma.agentAttachment.findMany({
    where: { runId: childRunId },
    orderBy: { createdAt: "asc" },
  });
  if (childRows.length === 0) return [];

  const resources: SessionResource[] = childRows.map((row) => ({
    type: "file",
    fileId: row.id,
    filename: row.filename,
    mime: row.contentType,
    mountPath: trayPath(row.filename),
    bytes: new Uint8Array(row.bytes),
  }));

  try {
    const backend = await getAgentBackend();
    await backend.mountSessionResources(parentSessionId, resources, {
      runId: parentRunId,
    });
  } catch (err) {
    log.warn("subagent: failed to materialize files into parent sandbox", {
      parentRunId,
      childRunId,
      slug,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  return childRows.map((row) => ({
    filename: row.filename,
    path: trayPath(row.filename),
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  }));
}
