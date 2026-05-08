import { File } from "node:buffer";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { toFile } from "@anthropic-ai/sdk";
import yauzl from "yauzl";
import { getAnthropicClient } from "../agent-backend/instance.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

const SKILL_BUNDLE_DIR = process.env.SKILL_BUNDLE_DIR ?? "data/skills";

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

/**
 * Persist a new skill bundle locally and reflect it to Anthropic via the
 * Skills API. Returns the new Skill row.
 */
export async function createSkill(args: CreateSkillArgs) {
  const validation = await validateSkillBundle(args.bytes);
  if (!validation.ok) {
    throw new Error(`Invalid skill bundle: ${validation.reason}`);
  }

  await mkdir(SKILL_BUNDLE_DIR, { recursive: true });
  const localPath = join(
    SKILL_BUNDLE_DIR,
    `${Date.now()}-${args.name.replace(/[^a-z0-9_-]+/gi, "_")}.zip`,
  );
  await writeFile(localPath, args.bytes);

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
      // Anthropic's Skills API expects the bundle as an array of
      // `Uploadable`s under `files[]` (the API extracts SKILL.md and
      // any sibling assets from the zip). `display_title` is the
      // human-readable label; descriptions are derived from SKILL.md
      // and not part of the create payload.
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

  const skill = await prisma.skill.create({
    data: {
      name: args.name,
      description: args.description ?? null,
      bundleStorageRef: localPath,
      anthropicSkillId,
      anthropicSkillVersion,
    },
  });
  log.info("skills: created", {
    id: skill.id,
    name: skill.name,
    bytes: args.bytes.byteLength,
    anthropicSkillId,
  });
  return skill;
}

export async function deleteSkill(id: string): Promise<void> {
  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) return;
  try {
    await unlink(skill.bundleStorageRef);
  } catch {
    // bundle may already be gone
  }
  await prisma.skill.delete({ where: { id } });
}

export async function readSkillBundle(id: string): Promise<Buffer | null> {
  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) return null;
  try {
    return await readFile(skill.bundleStorageRef);
  } catch {
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
