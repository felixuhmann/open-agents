import type { SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { storeRunAttachment } from "./runAttachments.js";

/**
 * Shared "file tray" directory that ties a delegation tree together. Every
 * subagent sandbox is seeded with the parent run's attachments here, and
 * every file a subagent attaches is materialized back into the parent
 * sandbox at the same path. Uses the conventional `/workspace` prefix, which
 * the sandbox tools remap to the real working directory.
 */
export const SUBAGENT_TRAY_DIR = "/workspace/subagent_files";

export type PropagatedFile = {
  attachmentId: string;
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
 * After a subagent run completes, surface the files it produced to the parent:
 *   1. copy each child `AgentAttachment` row onto the parent run so it renders
 *      in the parent's chat/download surface, and
 *   2. materialize the bytes into the parent sandbox at the shared tray path so
 *      the orchestrator can read/reprocess or forward them to another subagent.
 *
 * Best-effort: a failure to mount into the parent sandbox still leaves the
 * copied attachment rows in place, and the caller continues rather than
 * failing the whole delegation. Returns descriptors for the tool result text.
 */
export async function propagateSubagentFiles(input: {
  childRunId: string;
  parentRunId: string;
  parentSessionId: string;
  slug: string;
}): Promise<PropagatedFile[]> {
  const { childRunId, parentRunId, parentSessionId, slug } = input;

  const childRows = await prisma.agentAttachment.findMany({
    where: { runId: childRunId },
    orderBy: { createdAt: "asc" },
  });
  if (childRows.length === 0) return [];

  // Skip files the parent already has at the same name+size (e.g. a file the
  // parent seeded into the child and the child echoed back unchanged).
  const existing = await prisma.agentAttachment.findMany({
    where: { runId: parentRunId },
    select: { filename: true, sizeBytes: true },
  });
  const existingKey = new Set(existing.map((e) => `${e.filename}:${e.sizeBytes}`));

  const propagated: PropagatedFile[] = [];
  const resources: SessionResource[] = [];

  for (const row of childRows) {
    if (existingKey.has(`${row.filename}:${row.sizeBytes}`)) continue;
    const buf = Buffer.from(row.bytes);
    const stored = await storeRunAttachment(
      parentRunId,
      row.filename,
      row.contentType,
      buf,
    );
    resources.push({
      type: "file",
      fileId: stored.id,
      filename: row.filename,
      mime: row.contentType,
      mountPath: trayPath(row.filename),
      bytes: new Uint8Array(buf),
    });
    propagated.push({
      attachmentId: stored.id,
      filename: row.filename,
      path: trayPath(row.filename),
      contentType: row.contentType,
      sizeBytes: stored.sizeBytes,
    });
  }

  if (resources.length > 0) {
    try {
      const { getAgentBackend } = await import("../agent-backend/instance.js");
      const backend = await getAgentBackend();
      await backend.mountSessionResources(parentSessionId, resources, {
        runId: parentRunId,
      });
    } catch (err) {
      // The copied attachment rows still surface in chat; only the in-sandbox
      // materialization failed. Log and carry on.
      log.warn("subagent: failed to materialize files into parent sandbox", {
        parentRunId,
        childRunId,
        slug,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return propagated;
}
