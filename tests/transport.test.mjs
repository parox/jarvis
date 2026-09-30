import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { request } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { WebSocket } from 'ws'
import { readFileSync, writeFileSync, symlinkSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bridgeToken, PROJECT_ROOT, WORKSPACE } from '../bridge/security.mjs'

const facePort = 18773
const bridgePort = 18787
function call(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, headers }, (s) => {
      const chunks = []
      s.on('data', (chunk) => chunks.push(chunk))
      s.on('end', () => resolve({ status: s.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    r.setTimeout(5000, () => r.destroy(new Error('request timeout')))
    r.on('error', reject); r.end()
  })
}
function refusedWs(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers, handshakeTimeout: 3000 })
    ws.on('open', () => { ws.close(); reject(new Error('unauthorized socket opened')) })
    ws.on('error', () => resolve())
  })
}

test('real bridge and Vite proxy enforce HTTP/WS policy without making provider requests', { timeout: 25000 }, async (t) => {
  const previous = { PORT: process.env.PORT, JARVIS_BRIDGE_PORT: process.env.JARVIS_BRIDGE_PORT }
  process.env.PORT = String(facePort)
  process.env.JARVIS_BRIDGE_PORT = String(bridgePort)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })
  const child = fork(join(PROJECT_ROOT, 'bridge/server.mjs'), [], {
    cwd: PROJECT_ROOT,
    execArgv: ['--loader', join(PROJECT_ROOT, 'tests/sdk-loader.mjs')],
    env: { OPENAI_API_KEY: 'test-placeholder-not-a-real-key', PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(facePort), JARVIS_BRIDGE_PORT: String(bridgePort) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr.on('data', (x) => { stderr += x })
  const messages = []
  child.on('message', (x) => messages.push(x))
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit') } })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`bridge start timed out: ${stderr}`)), 6000)
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`bridge exited ${code}: ${stderr}`)) })
    child.stdout.on('data', (x) => {
      if (String(x).includes('authenticated bridge')) { clearTimeout(timeout); resolve() }
    })
  })
  const vite = await createViteServer({ root: PROJECT_ROOT, server: { watch: null }, logLevel: 'silent' })
  await vite.listen()
  t.after(() => vite.close())
  assert.equal(vite.httpServer.address().address, '127.0.0.1')
  assert.equal((await call(bridgePort, '/health')).status, 403)
  assert.equal((await call(bridgePort, '/health', { 'x-jarvis-token': '0'.repeat(64) })).status, 403)
  assert.equal((await call(bridgePort, '/health', { 'x-jarvis-token': bridgeToken(), host: `evil.example:${bridgePort}` })).status, 403)
  assert.equal((await call(facePort, '/.jarvis/bridge-token')).status, 403)
  assert.equal((await call(facePort, `/@fs${PROJECT_ROOT}/.jarvis/bridge-token`)).status, 403)
  const health = await call(facePort, '/bridge/health')
  assert.equal(health.status, 200)
  assert.deepEqual(JSON.parse(health.body), { ok: true, tts: false, stt: false })
  for (const headers of [{ origin: 'https://evil.example' }, { host: `evil.example:${facePort}` }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await call(facePort, '/bridge/health', headers)).status, 403)
  }
  const outside = mkdtempSync(join(tmpdir(), 'jarvis-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  const privateImage = join(outside, 'private.png')
  writeFileSync(privateImage, 'private image')
  const allowedImage = join(WORKSPACE, 'integration.png')
  const escaped = join(WORKSPACE, 'escape.png')
  writeFileSync(allowedImage, 'workspace image')
  symlinkSync(privateImage, escaped)
  t.after(() => { rmSync(allowedImage); rmSync(escaped) })
  const file = (path) => `/bridge/file?path=${encodeURIComponent(path)}`
  assert.equal((await call(facePort, file(allowedImage))).status, 200)
  assert.equal((await call(facePort, file(privateImage))).status, 400)
  assert.equal((await call(facePort, file(escaped))).status, 400)
  await refusedWs(`ws://127.0.0.1:${bridgePort}/ws`, { origin: `http://127.0.0.1:${facePort}` })
  await refusedWs(`ws://127.0.0.1:${facePort}/bridge/ws`, { origin: 'https://evil.example' })
  await refusedWs(`ws://127.0.0.1:${facePort}/bridge/ws`, {})
  const ws = new WebSocket(`ws://127.0.0.1:${facePort}/bridge/ws`, { origin: `http://127.0.0.1:${facePort}` })
  t.after(() => ws.terminate())
  const frames = []
  ws.on('message', (data) => frames.push(JSON.parse(String(data))))
  await once(ws, 'open')
  ws.send(JSON.stringify({ type: 'ask', text: 'transport test', id: 'test' }))
  const started = Date.now()
  while (!frames.some((x) => x.type === 'done') && Date.now() - started < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(frames.find((x) => x.type === 'done')?.text, 'stub: transport test')
  const policy = messages.find((x) => x.type === 'policy')
  assert.equal(policy.store, false)
  assert.equal(policy.model, 'gpt-6-astra')
  assert.ok(policy.tools.includes('mcp__jarvis__blade'))
  assert.ok(policy.tools.includes('mcp__jarvis_ui__ui_reset'))
  assert.ok(policy.tools.every((name) => name.startsWith('mcp__jarvis__') || name.startsWith('mcp__jarvis_ui__')))
  assert.equal(readFileSync(join(PROJECT_ROOT, 'src/lib/types.ts'), 'utf8').includes('dangerouslyAllowBrowser'), false)
  ws.send(JSON.stringify({ type: 'ask', text: 'interrupt me', id: 'old' }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  ws.send(JSON.stringify({ type: 'interrupt' }))
  ws.send(JSON.stringify({ type: 'ask', text: 'next', id: 'new' }))
  const deadline = Date.now() + 3000
  while (!frames.some((x) => x.type === 'done' && x.ask === 'new') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(frames.find((x) => x.type === 'done' && x.ask === 'new')?.text, 'stub: next')
  assert.equal(frames.some((x) => x.ask === 'old' && ['text', 'done'].includes(x.type)), false)
  ws.close()
})

test('legacy browser credentials fail frontend startup instead of entering the bundle', async (t) => {
  const previous = process.env.VITE_ANTHROPIC_API_KEY
  process.env.VITE_ANTHROPIC_API_KEY = 'test-placeholder-not-a-real-key'
  t.after(() => {
    if (previous === undefined) delete process.env.VITE_ANTHROPIC_API_KEY
    else process.env.VITE_ANTHROPIC_API_KEY = previous
  })
  await assert.rejects(createViteServer({ root: PROJECT_ROOT, logLevel: 'silent' }), /Unsupported frontend variable VITE_ANTHROPIC_API_KEY/)
})
