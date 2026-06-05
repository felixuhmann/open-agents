import { z } from "zod";
import { CreateUserInput, UpdateUserInput } from "@open-agents/types";
import { defineControlPlaneTool, idParam } from "../defineTool.js";

export const userControlPlaneTools = [
  defineControlPlaneTool({
    name: "users_list",
    title: "List users",
    description: "List all deployment users.",
    auth: "admin",
    method: "GET",
    path: "/api/users",
    input: z.object({}),
  }),
  defineControlPlaneTool({
    name: "users_create",
    title: "Create user",
    description: "Create a new user account.",
    auth: "admin",
    method: "POST",
    path: "/api/users",
    input: CreateUserInput,
  }),
  defineControlPlaneTool({
    name: "users_update",
    title: "Update user",
    description: "Update user name or role.",
    auth: "admin",
    method: "PATCH",
    path: "/api/users/:id",
    pathParams: ["id"],
    input: UpdateUserInput.extend(idParam),
  }),
  defineControlPlaneTool({
    name: "users_delete",
    title: "Delete user",
    description: "Delete a user account (cannot delete yourself).",
    auth: "admin",
    method: "DELETE",
    path: "/api/users/:id",
    pathParams: ["id"],
    input: z.object(idParam),
  }),
];
