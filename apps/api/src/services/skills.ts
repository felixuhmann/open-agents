import { File } from "node:buffer";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { toFile } from "@anthropic-ai/sdk";
import yauzl from "yauzl";
import { getAnthropicClient } from "../agent-backend/instance.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import {
  bundlePathForStorageRef,
  getSkillBundleDir,
  resolveSkillBundlePath,
  toBundleStorageRef,
} from "./skillBundlePaths.js";

/**
 * Quick-and-dirty zip validation: open the bundle in-memory, scan for a
 * top-level `SKILL.md`. Anthropic's Skills API requires the bundle to
 * conform to its skill schema; we do not re-validate that here.
 */
async function validateSkillBundle(
  bytes: Buffer,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        resolve({ ok: false, reason: "not a valid zip file" });
        return;
      }
      let foundSkillMd = false;
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName === "SKILL.md" || entry.fileName.endsWith("/SKILL.md")) {
          foundSkillMd = true;
        }
        zip.readEntry();
      });
      zip.on("end", () => {
        if (foundSkillMd) resolve({ ok: true });
        else resolve({ ok: false, reason: "bundle is missing SKILL.md" });
      });
      zip.on("error", () => resolve({ ok: false, reason: "zip read error" }));
      zip.readEntry();
    });
  });
}

export type CreateSkillArgs = {
  name: string;
  description?: string;
  filename: string;
  bytes: Buffer;
};

async function uploadSkillVersion(args: {
  name: string;
  filename: string;
  bytes: Buffer;
}): Promise<{ anthropicSkillId: string | null; anthropicSkillVersion: string | null }> {
  let anthropicSkillId: string | null = null;
  let anthropicSkillVersion: string | null = null;
  try {
    const client = await getAnthropicClient();
    const beta = client.beta as unknown as {
      skills?: {
        create(body: { display_title?: string; files?: unknown[] }): Promise<unknown>;
      };
    };
    if (beta.skills?.create) {
      const file = await toFile(args.bytes, args.filename, { type: "application/zip" });
      const res = await beta.skills.create({
        display_title: args.name,
        files: [file],
      });
      if (res && typeof res === "object") {
        const r = res as { id?: unknown; latest_version?: unknown; version?: unknown };
        if (typeof r.id === "string") anthropicSkillId = r.id;
        if (typeof r.latest_version === "string")
          anthropicSkillVersion = r.latest_version;
        else if (typeof r.version === "string") anthropicSkillVersion = r.version;
      }
    } else {
      log.warn("skills: SDK has no beta.skills.create — bundle stored locally only");
    }
  } catch (err) {
    log.warn("skills: anthropic upload failed; bundle still stored locally", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return { anthropicSkillId, anthropicSkillVersion };
}

async function persistBundle(args: {
  name: string;
  filename: string;
  bytes: Buffer;
  versionNumber: number;
}): Promise<string> {
  const bundleDir = getSkillBundleDir();
  await mkdir(bundleDir, { recursive: true });
  const safeName = args.name.replace(/[^a-z0-9_-]+/gi, "_");
  const fileName = `${Date.now()}-${safeName}-v${args.versionNumber}.zip`;
  const localPath = bundlePathForStorageRef(fileName);
  await writeFile(localPath, args.bytes);
  return toBundleStorageRef(fileName);
}

/**
 * Persist a new skill bundle locally and reflect it to Anthropic via the
 * Skills API. Returns the new Skill row.
 */
export async function createSkill(args: CreateSkillArgs) {
  const validation = await validateSkillBundle(args.bytes);
  if (!validation.ok) {
    throw new Error(`Invalid skill bundle: ${validation.reason}`);
  }

  const localPath = await persistBundle({ ...args, versionNumber: 1 });
  const { anthropicSkillId, anthropicSkillVersion } = await uploadSkillVersion(args);

  const skill = await prisma.skill.create({
    data: {
      name: args.name,
      description: args.description ?? null,
      versions: {
        create: {
          versionNumber: 1,
          filename: args.filename,
          bundleStorageRef: localPath,
          anthropicSkillId,
          anthropicSkillVersion,
        },
      },
    },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  log.info("skills: created", {
    id: skill.id,
    name: skill.name,
    bytes: args.bytes.byteLength,
    anthropicSkillId,
  });
  return skill;
}

export type CreateSkillVersionArgs = {
  skillId: string;
  filename: string;
  bytes: Buffer;
};

export async function createSkillVersion(args: CreateSkillVersionArgs) {
  const validation = await validateSkillBundle(args.bytes);
  if (!validation.ok) {
    throw new Error(`Invalid skill bundle: ${validation.reason}`);
  }

  const skill = await prisma.skill.findUnique({
    where: { id: args.skillId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!skill) throw new Error(`Skill not found: ${args.skillId}`);

  const versionNumber = (skill.versions[0]?.versionNumber ?? 0) + 1;
  const localPath = await persistBundle({
    name: skill.name,
    filename: args.filename,
    bytes: args.bytes,
    versionNumber,
  });
  const { anthropicSkillId, anthropicSkillVersion } = await uploadSkillVersion({
    name: skill.name,
    filename: args.filename,
    bytes: args.bytes,
  });

  const version = await prisma.skillVersion.create({
    data: {
      skillId: skill.id,
      versionNumber,
      filename: args.filename,
      bundleStorageRef: localPath,
      anthropicSkillId,
      anthropicSkillVersion,
    },
  });
  await prisma.skill.update({
    where: { id: skill.id },
    data: { updatedAt: new Date() },
  });
  log.info("skills: version created", {
    skillId: skill.id,
    versionId: version.id,
    versionNumber,
    bytes: args.bytes.byteLength,
    anthropicSkillId,
  });
  return version;
}

export async function deleteSkill(id: string): Promise<void> {
  const skill = await prisma.skill.findUnique({
    where: { id },
    include: { versions: true },
  });
  if (!skill) return;
  for (const version of skill.versions) {
    try {
      const path = await resolveSkillBundlePath(version.bundleStorageRef);
      if (path) await unlink(path);
    } catch {
      // bundle may already be gone
    }
  }
  await prisma.skill.delete({ where: { id } });
}

export async function readSkillBundle(versionId: string): Promise<Buffer | null> {
  const version = await prisma.skillVersion.findUnique({ where: { id: versionId } });
  if (!version) return null;
  const path = await resolveSkillBundlePath(version.bundleStorageRef);
  if (!path) {
    log.warn("skills: bundle not found on disk", {
      versionId,
      bundleStorageRef: version.bundleStorageRef,
      bundleDir: getSkillBundleDir(),
    });
    return null;
  }
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(path);
  } catch (err) {
    log.warn("skills: bundle read failed", {
      versionId,
      path,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function makeFileFromBundle(id: string): Promise<File | null> {
  const bytes = await readSkillBundle(id);
  if (!bytes) return null;
  return new File([new Uint8Array(bytes)], `${id}.zip`, {
    type: "application/zip",
  });
}
