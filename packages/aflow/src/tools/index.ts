import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserTool } from "./ask-user-tool";
import { registerSpecflowWorkflowTools } from "./specflow-workflow-tools";
import { registerWorkflowFileTools } from "./workflow-file-tools";

export function registerAflowTools(pi: ExtensionAPI): void {
  registerAskUserTool(pi);
  registerWorkflowFileTools(pi);
  registerSpecflowWorkflowTools(pi);
}
