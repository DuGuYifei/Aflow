export interface WorkflowSession {
  id: string;
  name: string;
  agentId: string;
  createdAt: string;
  /**
   * Serialized JSON array of ACP `McpServer` entries to attach to this
   * session at creation time. Stored as a raw string in YAML for
   * round-trip stability and to match the upstream ACP schema 1:1.
   * Empty / undefined means no MCP servers.
   */
  mcpServers?: string;
}
