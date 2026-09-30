export default class FakeOpenAI {
  responses = { create: async (request, { signal }) => {
    process.send?.({ type: 'policy', tools: request.tools.map((t) => t.name), store: request.store, model: request.model })
    const text = request.input.at(-1).content
    return (async function* () {
      if (text === 'interrupt me') await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500)
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
      })
      signal.throwIfAborted()
      yield { type: 'response.output_text.delta', delta: `stub: ${text}` }
      yield { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `stub: ${text}`, annotations: [] }] }] } }
    })()
  } }
}
