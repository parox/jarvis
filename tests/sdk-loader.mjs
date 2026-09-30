// Test-only replacement: run the real bridge without login, network model calls
// or configured MCP subprocesses. Actual SDK tool/server constructors are used.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (url.endsWith('/bridge/server.mjs')) {
    return { ...result, source: String(result.source).replace(
      "import { query } from '@anthropic-ai/claude-agent-sdk'",
      "import { query } from '../tests/stub-agent.mjs'",
    ) }
  }
  return result
}
