import OpenAI from 'openai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

// Only explicitly selected tools are advertised and callable, including when a
// model fabricates a function name. MCP credentials never go to OpenAI.
export async function connectTools(servers, allowed) {
  const clients = []
  const registry = new Map()
  const close = async () => { await Promise.allSettled(clients.map((c) => c.close())) }
  try {
    for (const [key, config] of Object.entries(servers)) {
      const client = new Client({ name: 'jarvis', version: '1.0.0' })
      clients.push(client)
      if (config.instance) {
        const [a, b] = InMemoryTransport.createLinkedPair()
        await config.instance.connect(b)
        await client.connect(a)
      } else if (config.command && (!config.type || config.type === 'stdio')) {
        await client.connect(new StdioClientTransport({ command: config.command, args: config.args ?? [], env: config.env, stderr: 'ignore' }))
      } else if (config.type === 'http' || config.type === 'sse') {
        const url = new URL(config.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid MCP URL')
        const Transport = config.type === 'sse' ? SSEClientTransport : StreamableHTTPClientTransport
        await client.connect(new Transport(url, { requestInit: { headers: config.headers ?? {} } }))
      } else throw new Error('Unsupported MCP transport')
      let cursor
      do {
        const page = await client.listTools(cursor ? { cursor } : {})
        for (const t of page.tools) {
          const name = `mcp__${key}__${t.name}`
          if (!allowed(name)) continue
          if (name.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Tool name cannot be represented by OpenAI')
          registry.set(name, {
            definition: { type: 'function', name, description: t.description ?? '', parameters: t.inputSchema, strict: false },
            call: (args, signal) => client.callTool({ name: t.name, arguments: args }, undefined, { signal, timeout: 20000 }),
          })
        }
        cursor = page.nextCursor
      } while (cursor)
    }
    return { registry, close }
  } catch (error) { await close(); throw error }
}

export function toolOutput(result) {
  const blocks = []
  if (result.isError) blocks.push({ type: 'input_text', text: 'Tool failed:' })
  for (const block of result.content ?? []) {
    if (block.type === 'text') blocks.push({ type: 'input_text', text: block.text })
    else if (block.type === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(block.mimeType)) {
      blocks.push({ type: 'input_image', image_url: `data:${block.mimeType};base64,${block.data}` })
    }
  }
  return blocks.length ? blocks : [{ type: 'input_text', text: JSON.stringify(result.structuredContent ?? { ok: !result.isError }) }]
}

export class OpenAIAgent {
  constructor({ model, effort, instructions, registry, allowed, client }) {
    this.client = client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 60000 })
    this.model = model
    this.effort = effort
    this.instructions = instructions
    this.registry = registry
    this.allowed = allowed
    this.history = []
  }
  async run(text, emit, signal) {
    // Commit only complete turns. Failed/interrupted tool sequences must never
    // leave orphaned call IDs in the next request.
    const input = [...this.history, { role: 'user', content: text }]
    let answer = ''
    for (let round = 0; round < 24; round++) {
      signal.throwIfAborted()
      const stream = await this.client.responses.create({
        model: this.model, instructions: this.instructions, input,
        tools: [...this.registry.entries()].filter(([name]) => this.allowed(name)).map(([, t]) => t.definition),
        reasoning: { effort: this.effort }, stream: true, store: false,
        include: ['reasoning.encrypted_content'],
        max_output_tokens: 4096, parallel_tool_calls: false,
      }, { signal })
      let response
      for await (const event of stream) {
        signal.throwIfAborted()
        if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
          answer += event.delta
          emit({ type: 'text', delta: event.delta })
        } else if (event.type === 'response.completed') response = event.response
        else if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new Error('OpenAI did not complete the response')
      }
      if (!response || response.status !== 'completed') throw new Error('OpenAI stream ended without completion')
      input.push(...response.output)
      const calls = response.output.filter((item) => item.type === 'function_call')
      if (!calls.length) {
        signal.throwIfAborted()
        // Bound retained context; clearing whole completed turns avoids breaking
        // call/output pairing. A new context starts after this limit.
        this.history = JSON.stringify(input).length <= 250000 ? input : []
        emit({ type: 'done', text: answer, costUsd: null, usage: response.usage })
        return
      }
      for (const call of calls) {
        signal.throwIfAborted()
        let output
        const entry = this.registry.get(call.name)
        if (!entry || !this.allowed(call.name)) output = [{ type: 'input_text', text: 'Blocked by local tool policy. Do not bypass it.' }]
        else {
          let args
          try { args = JSON.parse(call.arguments); if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Invalid arguments') }
          catch { output = [{ type: 'input_text', text: 'Invalid tool arguments' }] }
          if (!output) {
            emit({ type: 'tool', name: call.name })
            try { output = toolOutput(await entry.call(args, signal)) }
            catch { signal.throwIfAborted(); output = [{ type: 'input_text', text: 'Tool failed. Check its configuration.' }] }
          }
        }
        signal.throwIfAborted()
        input.push({ type: 'function_call_output', call_id: call.call_id, output })
      }
    }
    throw new Error('Tool round limit reached')
  }
}
