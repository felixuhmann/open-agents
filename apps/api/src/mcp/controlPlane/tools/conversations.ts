import { z } from "zod";
import {
  CreateConversationInput,
  ListConversationsQuery,
  SendConversationMessageInput,
} from "@open-agents/types";
import { defineControlPlaneTool, idParam } from "../defineTool.js";

export const conversationControlPlaneTools = [
  defineControlPlaneTool({
    name: "conversations_list",
    title: "List conversations",
    description: "List chat conversations for the signed-in user.",
    auth: "user",
    method: "GET",
    path: "/api/conversations",
    queryFields: ["agentSlug"],
    input: ListConversationsQuery,
  }),
  defineControlPlaneTool({
    name: "conversations_create",
    title: "Create conversation",
    description: "Start a new chat conversation with an agent.",
    auth: "user",
    method: "POST",
    path: "/api/conversations",
    input: CreateConversationInput,
  }),
  defineControlPlaneTool({
    name: "conversations_get",
    title: "Get conversation",
    description: "Get conversation metadata and message history.",
    auth: "user",
    method: "GET",
    path: "/api/conversations/:id",
    pathParams: ["id"],
    input: z.object(idParam),
  }),
  defineControlPlaneTool({
    name: "conversations_trace",
    title: "Get conversation trace",
    description: "Get operator debug trace for a conversation (runs, events, timing).",
    auth: "operator",
    method: "GET",
    path: "/api/conversations/:id/trace",
    pathParams: ["id"],
    input: z.object(idParam),
  }),
  defineControlPlaneTool({
    name: "conversations_send_message",
    title: "Send chat message",
    description: "Enqueue a user message and start an agent run.",
    auth: "user",
    method: "POST",
    path: "/api/conversations/:id/messages",
    pathParams: ["id"],
    input: SendConversationMessageInput.extend(idParam),
  }),
];
