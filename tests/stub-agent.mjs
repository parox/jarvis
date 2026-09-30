export function query({ prompt, options }) {
  let stopped = false
  process.send?.({
    type: 'policy', tools: options.tools, strict: options.strictMcpConfig,
    persist: options.persistSession, cwd: options.cwd,
    servers: Object.keys(options.mcpServers),
  })
  return {
    async *[Symbol.asyncIterator]() {
      const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }
      const result = await options.hooks.PreToolUse[0].hooks[0](input)
      process.send?.({ type: 'hook', decision: result.hookSpecificOutput.permissionDecision })
      yield { type: 'system', subtype: 'init', mcp_servers: Object.keys(options.mcpServers).map((name) => ({ name, status: 'connected' })) }
      for await (const message of prompt) {
        if (stopped) break
        yield { type: 'result', subtype: 'success', result: `stub: ${message.message.content}` }
      }
    },
    close() { stopped = true },
    async interrupt() {},
  }
}
