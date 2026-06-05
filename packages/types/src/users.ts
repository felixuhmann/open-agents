import { z } from "zod";
import { UserRole } from "./agents.js";

export const CreateUserInput = z.object({
  email: z.string().email().describe("User email address"),
  name: z.string().min(1).max(120).optional().describe("Display name"),
  password: z.string().min(8).max(200).describe("Initial password"),
  role: UserRole.default("member").describe("Role (default: member)"),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

export const UpdateUserInput = z.object({
  name: z.string().min(1).max(120).optional().describe("Display name"),
  role: UserRole.optional().describe("Role"),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;
