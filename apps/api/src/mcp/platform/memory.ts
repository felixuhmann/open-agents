import type { Prisma } from "@open-agents/db";
import { z } from "zod";
import { prisma } from "../../db.js";
import { defineTool, type PlatformHandler } from "../types.js";

/**
 * Generic JSON-doc collection store scoped to one agent. The agent learns
 * the collection layout from its system prompt or an attached skill — no
 * schema enforcement in v1.
 *
 * The `filter` accepted by `memory_list` is intentionally tiny: a flat
 * `{ field: value }` object that we apply as JSON `path` equality through
 * Prisma's JSON filter. v1.5 will introduce per-collection schemas (and
 * with them richer filters).
 */

const MAX_COLLECTION = 60;
const MAX_LIST_PAGE = 200;

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

const UpdateInput = z.object({
  id: z.string().min(1),
  doc: z.record(z.string(), z.unknown()),
});

const DeleteInput = z.object({
  id: z.string().min(1),
});

export const memoryHandler: PlatformHandler = {
  key: "memory",
  name: "Workspace memory",
  description:
    "Persistent JSON-doc collections scoped to this agent. Agents create, read, list, update and delete documents grouped under named collections.",
  tools: [
    defineTool({
      name: "memory_create",
      description: "Create a new document in a collection. Returns the new document id.",
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
        "List documents in a collection with optional flat equality filter on top-level fields. Returns documents and an opaque next cursor.",
      input: ListInput,
      handler: async (input, ctx) => {
        const filterClauses: Record<string, unknown>[] = [];
        if (input.filter) {
          for (const [key, value] of Object.entries(input.filter)) {
            filterClauses.push({ doc: { path: [key], equals: value } });
          }
        }
        const rows = await prisma.memoryDoc.findMany({
          where: {
            agentId: ctx.agentId,
            collection: input.collection,
            AND: filterClauses,
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
