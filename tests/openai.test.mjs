import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIAgent, connectTools, toolOutput } from '../bridge/openai.mjs'
import { displayServer } from '../bridge/panels.mjs'
const call = (name, args = '{}') => ({ type: 'function_call', name, arguments: args, call_id: 'c1', id: 'fc1' })
function fixture(outputs, registry = new Map(), allowed = () => true) {
  const requests = []
  const events = []
  const client = { responses: { create: async (request) => {
    requests.push(structuredClone(request))
    const output = outputs.shift()
    return (async function* () {
      if (output instanceof Error) throw output
      if (output === 'incomplete') { yield { type: 'response.incomplete' }; return }
      if (output.length === 0) yield { type: 'response.output_text.delta', delta: 'Answer.' }
      yield { type: 'response.completed', response: { status: 'completed', output } }
    })()
  } } }
  const agent = new OpenAIAgent({ model: 'test', effort: 'medium', instructions: 'test', registry, allowed, client })
  const run = (text = 'test', signal = new AbortController().signal) => agent.run(text, (x) => events.push(x), signal)
  return { agent, requests, events, run }
}
test('streaming, local history and no provider response storage', async () => {
  const f = fixture([[], []])
  await f.run('first'); await f.run('second')
  assert.equal(f.requests[0].store, false)
  assert.equal(f.requests[0].stream, true)
  assert.equal(f.requests[0].parallel_tool_calls, false)
  assert.equal(f.requests[1].input[0].content, 'first')
  assert.deepEqual(f.events.map((x) => x.type), ['text', 'done', 'text', 'done'])
})
test('fabricated and denied tools are never invoked or announced', async () => {
  let ran = false
  const registry = new Map([['forbidden', { definition: {}, call: () => { ran = true } }]])
  const f = fixture([[call('forbidden'), { ...call('Bash'), call_id: 'c2' }], []], registry, () => false)
  await f.run()
  assert.equal(ran, false)
  assert.equal(f.events.some((x) => x.type === 'tool'), false)
  assert.ok(f.requests[1].input.filter((x) => x.type === 'function_call_output').every((x) => x.output[0].text.startsWith('Blocked')))
})
test('selected function executes, invalid JSON does not, errors remain generic', async () => {
  let count = 0
  const entry = { definition: { type: 'function', name: 'selected' }, call: async () => { count++; throw new Error('secret-token') } }
  const f = fixture([[call('selected', 'bad')], [call('selected')], []], new Map([['selected', entry]]))
  await f.run()
  assert.equal(count, 1)
  assert.equal(JSON.stringify(f.requests).includes('secret-token'), false)
})
test('incomplete and aborted turns do not commit history', async () => {
  const f = fixture(['incomplete', []])
  await assert.rejects(f.run(), /complete/)
  assert.deepEqual(f.agent.history, [])
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.run('cancel', controller.signal))
  assert.equal(f.requests.length, 1)
  await f.run('retry')
  assert.equal(f.requests[1].input.length, 1)
})
test('tool loop has a finite ceiling', async () => {
  const f = fixture(Array.from({ length: 24 }, () => [call('Bash')]))
  await assert.rejects(f.run(), /round limit/)
  assert.equal(f.requests.length, 24)
  assert.deepEqual(f.agent.history, [])
})
test('MCP discovery filters exact names and validates arguments before handler', async () => {
  const emitted = []
  const tools = await connectTools({ jarvis: displayServer(() => {}, (x) => emitted.push(x)) }, (name) => name === 'mcp__jarvis__blade')
  try {
    assert.deepEqual([...tools.registry.keys()], ['mcp__jarvis__blade'])
    assert.equal((await tools.registry.get('mcp__jarvis__blade').call({ kind: 'invalid' }, new AbortController().signal)).isError, true)
    assert.deepEqual(emitted, [])
  } finally { await tools.close() }
})
test('camera image results retain image blocks for OpenAI vision', () => {
  assert.deepEqual(toolOutput({ content: [{ type: 'image', mimeType: 'image/png', data: 'dGVzdA==' }] }), [{ type: 'input_image', image_url: 'data:image/png;base64,dGVzdA==' }])
})

test('successful tool results and encrypted reasoning are replayed together', async () => {
  const name = 'selected'
  const reasoning = { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque' }
  const f = fixture([[reasoning, call(name)], []], new Map([[name, { definition: { type: 'function', name }, call: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }]]))
  await f.run()
  assert.deepEqual(f.requests[0].include, ['reasoning.encrypted_content'])
  assert.deepEqual(f.requests[1].input[1], reasoning)
  assert.equal(f.requests[1].input[2].call_id, 'c1')
  assert.equal(f.requests[1].input[3].call_id, 'c1')
  assert.equal(f.requests[1].input[3].output[0].text, 'ok')
})


test('missing backend API key does not break initialization or expose credentials', async (t) => {
  const previous = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous })
  const agent = new OpenAIAgent({ model: 'test', effort: 'medium', instructions: 'test', registry: new Map(), allowed: () => true })
  await assert.rejects(agent.run('test', () => {}, new AbortController().signal), { code: 'missing_api_key' })
  assert.deepEqual(agent.history, [])
})
