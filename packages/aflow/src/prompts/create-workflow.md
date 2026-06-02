Create or update a Specflow workflow for the user's business goal.

First understand the business logic:
- Identify the goal, actors/systems, required inputs, decision points, success criteria, and where human review is useful.
- If any of those are unclear or materially affect the workflow, use ask_user before drafting.
- If configured agent server ids or capabilities are unknown, inspect .aflow/.specflow/agent-servers.json when possible, or ask_user which configured agent server to use.

Default output path:
- New reusable/team workflows should go under .aflow/.specflow/agentflows/<workflow-id>.yaml.
- Exploratory or user-local drafts should go under .aflow/.specflow/agentflows-local/<workflow-id>.yaml, which is gitignored.
- Persist the final YAML with specflow_write_workflow instead of only showing it in chat.

Use concrete workflow structure:
- sessions with configured agentServerId values when known
- input variables named specflow_*
- step nodes with focused prompts
- gate nodes when branching is meaningful
- pauseAfterRun only when human interaction is genuinely needed
- edges with transmit/outputTag only when downstream nodes need upstream output

If placeholders are necessary for a non-runnable draft, say that validation/run requires configuring real agent servers first.

Validate the draft before recommending a run when all runnable agentServerId values are configured. If placeholders are still present, explain what must be configured before validation or running.
