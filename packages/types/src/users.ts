import { z } from "zod";
import { UserRole } from "./agents.js";

export const UserProfileFields = z.object({
  phoneNumber: z.string().trim().max(80).nullable().optional(),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  department: z.string().trim().max(160).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  timezone: z.string().trim().max(120).nullable().optional(),
});
export type UserProfileFields = z.infer<typeof UserProfileFields>;

export const CreateUserInput = z.object({
  email: z.string().email().describe("User email address"),
  name: z.string().min(1).max(120).optional().describe("Display name"),
  password: z.string().min(8).max(200).describe("Initial password"),
  role: UserRole.default("member").describe("Role (default: member)"),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;

export const UpdateProfileInput = UserProfileFields.extend({
  name: z.string().trim().min(1).max(120).optional().describe("Display name"),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const UpdateUserInput = UpdateProfileInput.extend({
  role: UserRole.optional().describe("Role"),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;
