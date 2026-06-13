import type { CanvasDoc } from "./canvas-doc";

export const UNCONFIGURED_AGENT_SERVER_ID = "unconfigured";
export const DEFAULT_SEED_WORKFLOW_ID = "example-v2-review-loop";

export const SEED_CANVAS_DOCS: CanvasDoc[] = [
  {
    id: DEFAULT_SEED_WORKFLOW_ID,
    version: 2,
    name: "Example v2 review loop",
    variables: [
      {
        name: "specflow_task",
        title: "Task",
        description: "The implementation request or ticket to work on.",
        required: true,
      },
    ],
    sessions: [
      { id: "builder", name: "builder", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
      { id: "reviewer", name: "reviewer", agentServerId: UNCONFIGURED_AGENT_SERVER_ID },
    ],
    nodes: [
      {
        kind: "start",
        id: "start",
        alias: "START",
        title: "Start",
        x: 60,
        y: 180,
        w: 140,
        sessionId: null,
      },
      {
        kind: "step",
        id: "plan",
        alias: "01",
        title: "Plan",
        prompt: `Read <specflow_task>.

Create a concise implementation plan with:
- files or areas to inspect
- expected changes
- verification commands
- risks or unknowns`,
        sessionId: "builder",
        x: 260,
        y: 160,
        w: 240,
      },
      {
        kind: "step",
        id: "implement",
        alias: "02",
        title: "Implement",
        prompt: `Implement the approved plan for <specflow_task>.

Keep the change focused. When finished, report the files changed, important decisions, and verification commands you ran.`,
        sessionId: "builder",
        paths: ["src/", "tests/"],
        x: 560,
        y: 160,
        w: 260,
      },
      {
        kind: "step",
        id: "review",
        alias: "03",
        title: "Review",
        prompt: `Review <specflow_change_summary>.

Focus on correctness, regressions, missing tests, and whether the implementation satisfies <specflow_task>.`,
        sessionId: "reviewer",
        x: 880,
        y: 160,
        w: 250,
      },
      {
        kind: "gate",
        id: "verdict",
        alias: "G1",
        title: "Review verdict",
        decisionCriteria: `Choose pass only when the implementation is ready.
Choose rework when the builder should address review findings and try again.`,
        branches: [
          { id: "pass", label: "pass", description: "The workflow can finish." },
          { id: "rework", label: "rework", description: "Return to implementation.", maxTraversals: 2 },
        ],
        x: 1190,
        y: 170,
        w: 220,
      },
      {
        kind: "end",
        id: "done",
        alias: "END",
        title: "Done",
        x: 1480,
        y: 190,
        w: 140,
        sessionId: null,
      },
    ],
    edges: [
      { id: "e-start-plan", from: "start", to: "plan" },
      { id: "e-plan-implement", from: "plan", to: "implement" },
      {
        id: "e-implement-review",
        from: "implement",
        to: "review",
        transmit: true,
        outputTag: "change_summary",
        handoffPrompt: "Summarize the implementation result, files changed, and verification for review.",
      },
      { id: "e-review-verdict", from: "review", to: "verdict" },
      { id: "e-verdict-done", from: "verdict", to: "done", branch: "pass" },
      { id: "e-verdict-rework", from: "verdict", to: "implement", branch: "rework" },
    ],
  },
];
