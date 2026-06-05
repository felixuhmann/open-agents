import { adminControlPlaneTools } from "./admin.js";
import { agentControlPlaneTools } from "./agents.js";
import { conversationControlPlaneTools } from "./conversations.js";
import { issueControlPlaneTools } from "./issues.js";
import { libraryControlPlaneTools } from "./library.js";
import { runControlPlaneTools } from "./runs.js";
import { userControlPlaneTools } from "./users.js";
import { workflowControlPlaneTools } from "./workflows.js";
import { workflowConversationControlPlaneTools } from "./workflowConversations.js";

export const CONTROL_PLANE_TOOLS = [
  ...agentControlPlaneTools,
  ...workflowControlPlaneTools,
  ...conversationControlPlaneTools,
  ...workflowConversationControlPlaneTools,
  ...runControlPlaneTools,
  ...issueControlPlaneTools,
  ...userControlPlaneTools,
  ...libraryControlPlaneTools,
  ...adminControlPlaneTools,
];
