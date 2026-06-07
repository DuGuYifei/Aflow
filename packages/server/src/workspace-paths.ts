import { join } from "node:path";
import {
  SPECFLOW_AGENTFLOW_PATH,
  SPECFLOW_DESIGN_PATH,
  SPECFLOW_PRD_PATH,
  SPECFLOW_WORKSPACE_PATH,
} from "@specflow/shared";

export function specflowRoot(root: string): string {
  return join(root, SPECFLOW_WORKSPACE_PATH);
}

export function agentflowRoot(root: string): string {
  return join(root, SPECFLOW_AGENTFLOW_PATH);
}

export function designRoot(root: string): string {
  return join(root, SPECFLOW_DESIGN_PATH);
}

export function prdRoot(root: string): string {
  return join(root, SPECFLOW_PRD_PATH);
}

export function agentflowsDir(root: string): string {
  return join(agentflowRoot(root), "agentflows");
}

export function localAgentflowsDir(root: string): string {
  return join(agentflowRoot(root), "agentflows-local");
}

export function canvasDir(root: string): string {
  return join(agentflowRoot(root), "canvas");
}

export function agentflowAssetsDir(root: string): string {
  return join(agentflowRoot(root), "assets");
}

export function runsDir(root: string): string {
  return join(agentflowRoot(root), "runs");
}

export function runLogsDir(root: string): string {
  return join(agentflowRoot(root), "run-logs");
}

export function designReferencesDir(root: string): string {
  return join(designRoot(root), "references");
}

export function designConversationsDir(root: string): string {
  return join(designRoot(root), "conversations");
}

export function designProjectsDir(root: string): string {
  return join(designRoot(root), "projects");
}

export function designSettingsPath(root: string): string {
  return join(designRoot(root), "settings.json");
}

export function prdDraftsDir(root: string): string {
  return join(prdRoot(root), "drafts");
}
