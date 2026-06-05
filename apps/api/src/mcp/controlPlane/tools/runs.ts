import { z } from "zod";
import { RunEventsQuery } from "@open-agents/types";
import { defineControlPlaneTool } from "../defineTool.js";

const runIdParam = {
  runId: z.string().min(1).describe("Agent run id"),
} as const;

const attachmentIdParam = {
  attachmentId: z.string().min(1).describe("Attachment id"),
} as const;

export const runControlPlaneTools = [
  defineControlPlaneTool({
    name: "runs_list_attachments",
    title: "List run attachments",
    description: "List files attached during an agent run.",
    auth: "user",
    method: "GET",
    path: "/api/runs/:runId/attachments",
    pathParams: ["runId"],
    input: z.object(runIdParam),
  }),
  defineControlPlaneTool({
    name: "runs_download_attachment",
    title: "Download run attachment",
    description: "Download attachment bytes for a run.",
    auth: "user",
    method: "GET",
    path: "/api/runs/:runId/attachments/:attachmentId",
    pathParams: ["runId", "attachmentId"],
    input: z.object({ ...runIdParam, ...attachmentIdParam }),
    notes: "Response body is raw file bytes (not JSON).",
  }),
  defineControlPlaneTool({
    name: "runs_events",
    title: "Stream run events",
    description:
      "Stream run events for live progress. Prefer conversations_get for completed history.",
    auth: "user",
    method: "GET",
    path: "/api/runs/:runId/events",
    pathParams: ["runId"],
    queryFields: ["lastEventId"],
    input: RunEventsQuery.extend(runIdParam),
    notes: "Returns an SSE (text/event-stream) body, not JSON.",
  }),
  defineControlPlaneTool({
    name: "workflow_runs_events",
    title: "Stream workflow run events",
    description: "Stream events for a workflow step run.",
    auth: "user",
    method: "GET",
    path: "/api/workflow-runs/:workflowRunId/events",
    pathParams: ["workflowRunId"],
    queryFields: ["lastEventId"],
    input: RunEventsQuery.extend({
      workflowRunId: z.string().min(1).describe("Workflow run id"),
    }),
    notes: "Returns an SSE (text/event-stream) body, not JSON.",
  }),
];
