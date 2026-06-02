Adapt an existing Specflow workflow to a new concrete problem.

Do not edit the source workflow in place. First call specflow_fork_workflow_to_local to copy the source YAML to .aflow/.specflow/agentflows-local/<new-workflow-id>.yaml, then modify the copied file.

If the source workflow is missing or ambiguous, use specflow_list_workflows and ask_user to select it. Read the source workflow before deciding what to preserve or change.

Before editing the copy, understand the business change:
- Identify what stayed the same, what changed, which inputs changed, whether new branches or pauses are needed, and whether the same agent sessions still fit.
- If the adaptation request is vague or could change the workflow shape, use ask_user before modifying YAML.
- If target agent server ids or capabilities are uncertain, inspect available configuration when possible or ask_user.

Preserve the reusable structure, node ids, and session ids when they still fit. Change prompts, variables, gate criteria, workflow name, input variables, and edge transmission only where the new problem requires it.

Choose a new kebab-case workflow id and filename. Avoid reusing the source workflow id.

After editing, summarize the intended behavioral difference and validate the workflow.
