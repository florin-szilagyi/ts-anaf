/**
 * Standard return type for all MCP tool handlers.
 * Mirrors the MCP protocol's CallToolResult shape.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
