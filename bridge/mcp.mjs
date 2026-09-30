// Provider-independent tool registration. No Claude CLI or global discovery.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
export const tool = (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler })
export function createSdkMcpServer({ name, version, instructions, tools }) {
  const instance = new McpServer({ name, version }, { instructions })
  for (const t of tools) instance.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.handler)
  return { instance }
}
