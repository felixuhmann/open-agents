import { posix as path } from "node:path";
import type { Prisma } from "@open-agents/db";
import { z } from "zod";
import { prisma } from "../../db.js";
import { remapWorkspacePath } from "../../services/sandboxShell.js";
import { defineTool, type PlatformHandler } from "../types.js";

/**
 * Generic JSON-doc collection store scoped to one agent. The agent learns
 * the collection layout from its system prompt, an attached skill, or by
 * calling `memory_collections` to inspect what it has already populated —
 * there is no schema enforcement in v1.
 *
 * The `filter` accepted by `memory_list` is intentionally tiny: a flat
 * `{ field: value }` object that we apply as JSON `path` equality through
 * Prisma's JSON filter. v1.5 will introduce per-collection schemas (and
 * with them richer filters).
 */

const MAX_COLLECTION = 60;
const MAX_LIST_PAGE = 200;

const CollectionsInput = z.object({});

const CreateInput = z.object({
  collection: z
    .string()
    .min(1)
    .max(MAX_COLLECTION)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscores"),
  doc: z.record(z.string(), z.unknown()),
});

const ReadInput = z.object({
  id: z.string().min(1),
});

const ListInput = z.object({
  collection: z.string().min(1).max(MAX_COLLECTION),
  filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_PAGE).default(50),
  cursor: z.string().optional(),
});

const ExportInput = z.object({
  collection: z.string().min(1).max(MAX_COLLECTION),
  filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  path: z.string().min(1),
});

const UpdateInput = z.object({
  id: z.string().min(1),
  doc: z.record(z.string(), z.unknown()),
});

const DeleteInput = z.object({
  id: z.string().min(1),
});

function filterClauses(
  filter: Record<string, string | number | boolean> | undefined,
): Record<string, unknown>[] {
  if (!filter) return [];
  return Object.entries(filter).map(([key, value]) => ({
    doc: { path: [key], equals: value },
  }));
}

function resolveSandboxPath(input: string, workspaceDir: string): string {
  const absolutePath = input.startsWith("/") ? input : path.join(workspaceDir, input);
  return remapWorkspacePath(absolutePath, workspaceDir);
}

export const memoryHandler: PlatformHandler = {
  key: "memory",
  name: "Workspace memory",
  description:
    "Persistent JSON-doc collections scoped to this agent. Agents create, read, list, update and delete documents grouped under named collections. Collection names are case-sensitive and free-form, so call `memory_collections` first to reuse an existing name instead of inventing a new one.",
  tools: [
    defineTool({
      name: "memory_collections",
      description:
        "List every collection that already has at least one document for this agent, with item counts. Call this BEFORE `memory_create` or `memory_list` whenever you are not 100% sure which collection name to use — the names are case-sensitive and a typo (e.g. `guest_list` vs `guestlist`) will read or write to a different store.",
      input: CollectionsInput,
      handler: async (_input, ctx) => {
        const rows = await prisma.memoryDoc.groupBy({
          by: ["collection"],
          where: { agentId: ctx.agentId },
          _count: { _all: true },
          orderBy: { collection: "asc" },
        });
        return {
          collections: rows.map((r) => ({
            name: r.collection,
            count: r._count._all,
          })),
        };
      },
    }),

    defineTool({
      name: "memory_create",
      description:
        "Create a new document in a collection. Returns the new document id. IMPORTANT: collection names are case-sensitive and not normalised — `guestlist` and `guest_list` are two different stores. If your system prompt or skill does not pin down the exact collection name, call `memory_collections` first and reuse an existing name when one fits.",
      input: CreateInput,
      handler: async (input, ctx) => {
        const row = await prisma.memoryDoc.create({
          data: {
            agentId: ctx.agentId,
            collection: input.collection,
            doc: input.doc as Prisma.InputJsonValue,
          },
          select: { id: true, collection: true, createdAt: true },
        });
        return row;
      },
    }),

    defineTool({
      name: "memory_read",
      description: "Read a single document by id.",
      input: ReadInput,
      handler: async (input, ctx) => {
        const row = await prisma.memoryDoc.findFirst({
          where: { id: input.id, agentId: ctx.agentId },
        });
        if (!row) return { error: "not_found" };
        return {
          id: row.id,
          collection: row.collection,
          doc: row.doc,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      },
    }),

    defineTool({
      name: "memory_list",
      description:
        "List documents in a collection with optional flat equality filter on top-level fields. Returns documents and an opaque next cursor. An empty `items` array means the named collection has no matching documents — it does NOT mean memory is broken; if you expected results, call `memory_collections` to confirm the collection name.",
      input: ListInput,
      handler: async (input, ctx) => {
        const filters = filterClauses(input.filter);
        const rows = await prisma.memoryDoc.findMany({
          where: {
            agentId: ctx.agentId,
            collection: input.collection,
            AND: filters,
            ...(input.cursor ? { id: { gt: input.cursor } } : {}),
          },
          orderBy: { id: "asc" },
          take: input.limit + 1,
        });
        const hasMore = rows.length > input.limit;
        const page = hasMore ? rows.slice(0, input.limit) : rows;
        return {
          items: page.map((r) => ({
            id: r.id,
            doc: r.doc,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
          nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
        };
      },
    }),

    defineTool({
      name: "memory_export",
      description:
        "Export every matching document in a collection directly to a JSON file in the active sandbox. The file shape is `{ items: [{ doc: ... }] }`, so downstream scripts can consume it without the documents flowing through the model. Returns only metadata about the file written.",
      input: ExportInput,
      handler: async (input, ctx) => {
        if (!ctx.sandbox) {
          throw new Error("memory_export requires an active sandbox");
        }

        const rows = await prisma.memoryDoc.findMany({
          where: {
            agentId: ctx.agentId,
            collection: input.collection,
            AND: filterClauses(input.filter),
          },
          orderBy: { id: "asc" },
          select: { doc: true },
        });

        const content = JSON.stringify(
          { items: rows.map((row) => ({ doc: row.doc })) },
          null,
          2,
        );
        const remotePath = resolveSandboxPath(input.path, ctx.sandbox.workspaceDir);
        await ctx.sandbox.writeFile(remotePath, Buffer.from(content, "utf8"));

        return {
          path: remotePath,
          requestedPath: input.path,
          collection: input.collection,
          count: rows.length,
          bytes: Buffer.byteLength(content, "utf8"),
        };
      },
    }),

    defineTool({
      name: "memory_update",
      description:
        "Replace an existing document by id. The new `doc` overwrites the previous one entirely.",
      input: UpdateInput,
      handler: async (input, ctx) => {
        const existing = await prisma.memoryDoc.findFirst({
          where: { id: input.id, agentId: ctx.agentId },
        });
        if (!existing) return { error: "not_found" };
        const row = await prisma.memoryDoc.update({
          where: { id: existing.id },
          data: { doc: input.doc as Prisma.InputJsonValue },
          select: { id: true, updatedAt: true },
        });
        return row;
      },
    }),

    defineTool({
      name: "memory_delete",
      description: "Delete a document by id.",
      input: DeleteInput,
      handler: async (input, ctx) => {
        const existing = await prisma.memoryDoc.findFirst({
          where: { id: input.id, agentId: ctx.agentId },
        });
        if (!existing) return { error: "not_found" };
        await prisma.memoryDoc.delete({ where: { id: existing.id } });
        return { ok: true };
      },
    }),
  ],
};
