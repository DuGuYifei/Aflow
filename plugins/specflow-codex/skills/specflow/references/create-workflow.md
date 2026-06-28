# Create Specflow Workflow

Read this before creating or substantially rewriting a Specflow workflow. Then read `workflow-authoring.md` before writing YAML.

Create or update a Specflow workflow for the user's business goal.

First understand the user's business logic before writing YAML:
- Identify the goal, actors/systems, required workflow variables, decision points, success criteria, and where human review is useful.
- If any of those are unclear or materially affect the workflow, use ask_user before drafting.
- If the agent server ids or agent capabilities are unknown, inspect them with Specflow tools when possible, or ask_user which configured agent server to use.

Ask for missing parameters only when they are required to make the workflow executable or materially change the workflow design. Otherwise, make conservative assumptions and state them briefly.

Also read `workflow-authoring.md` for the canonical YAML schema, examples, and validation checklist.

Default output path:
- New reusable/team workflows should go under .aflow/.specflow/agentflow/agentflows/<workflow-id>.yaml.
- Exploratory or user-local drafts should go under .aflow/.specflow/agentflow/agentflows-local/<workflow-id>.yaml, which is gitignored.
- Persist the final YAML with specflow_write_workflow instead of only showing it in chat.

Use concrete workflow structure:
- sessions with configured agentServerId values when known
- top-level variables named specflow_*
- step nodes with focused prompts
- gate nodes when branching is meaningful
- pauseAfterRun only when human interaction is genuinely needed
- edges with transmit/outputTag only when downstream nodes need upstream output

If you must use placeholder agentServerId values for a non-runnable draft, say that validation/run requires configuring real agent servers first.

Validate the draft before recommending a run when all runnable agentServerId values are configured. If placeholders are still present, explain what must be configured before validation or running.

