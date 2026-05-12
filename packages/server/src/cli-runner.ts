import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { WorkflowExecutor, type NodeStatusEvent, type RunStatusEvent } from "@specflow/bridge";
import type { WorkflowRun } from "@specflow/workflow";
import type { CanvasDoc } from "./canvas-doc";
import { canvasToWorkflow } from "./canvas-to-workflow";

export async function loadCanvasFile(filePath: string): Promise<CanvasDoc> {
  return parse(await readFile(filePath, "utf8")) as CanvasDoc;
}

export async function executeCanvasDoc(input: {
  doc: CanvasDoc;
  initialInput: string;
  cwd: string;
  onNodeStatus?: (event: NodeStatusEvent) => void;
  onRunStatus?: (event: RunStatusEvent) => void;
}): Promise<WorkflowRun> {
  const workflow = canvasToWorkflow(input.doc);
  const executor = new WorkflowExecutor({
    cwd: input.cwd,
    onNodeStatus: input.onNodeStatus,
    onRunStatus: input.onRunStatus,
  });
  return executor.run(workflow, input.initialInput);
}
