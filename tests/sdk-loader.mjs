// Replace only the OpenAI network client. Exercise the real agent and MCP code.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (url.endsWith('/bridge/openai.mjs')) return { ...result, source: String(result.source).replace(
    "import OpenAI from 'openai'", "import OpenAI from '../tests/stub-agent.mjs'",
  ) }
  return result
}
