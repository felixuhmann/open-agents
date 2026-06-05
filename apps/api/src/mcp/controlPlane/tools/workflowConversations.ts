import { z } from "zod";
import {
  CreateWorkflowConversationInput,
  ListWorkflowConversationsQuery,
  SendConversationMessageInput,
} from "@open-agents/types";
import { defineControlPlaneTool, idParam } from "../defineTool.js";

export const workflowConversationControlPlaneTools = [
  defineControlPlaneTool({
    name: "workflow_conversations_list",
    title: "List workflow conversations",
    description: "List workflow chat conversations for the signed-in user.",
    auth: "user",
    method: "GET",
    path: "/api/workflow-conversations",
    queryFields: ["workflowSlug"],
    input: ListWorkflowConversationsQuery,
  }),
  defineControlPlaneTool({
    name: "workflow_conversations_create",
    title: "Create workflow conversation",
    description: "Start a new workflow chat conversation.",
    auth: "user",
    method: "POST",
    path: "/api/workflow-conversations",
    input: CreateWorkflowConversationInput,
  }),
  defineControlPlaneTool({
    name: "workflow_conversations_get",
    title: "Get workflow conversation",
    description: "Get workflow conversation metadata and message history.",
    auth: "user",
    method: "GET",
    path: "/api/workflow-conversations/:id",
    pathParams: ["id"],
    input: z.object(idParam),
  }),
  defineControlPlaneTool({
    name: "workflow_conversations_trace",
    title: "Get workflow conversation trace",
    description: "Get operator debug trace for a workflow conversation.",
    auth: "operator",
    method: "GET",
    path: "/api/workflow-conversations/:id/trace",
    pathParams: ["id"],
    input: z.object(idParam),
  }),
  defineControlPlaneTool({
    name: "workflow_conversations_send_message",
    title: "Send workflow message",
    description: "Enqueue a user message on a workflow conversation.",
    auth: "user",
    method: "POST",
    path: "/api/workflow-conversations/:id/messages",
    pathParams: ["id"],
    input: SendConversationMessageInput.extend(idParam),
  }),
];
