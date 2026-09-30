import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request } from 'node:http'
import { bridgeToken, bridgeRequestAllowed, decideTool, frontendRequestAllowed, loadPolicy, portNumber, withinRoots } from '../bridge/security.mjs'
import { blockedAddress, vetTarget } from '../bridge/net.mjs'

const req = (headers) => ({ headers })
const token = 'a'.repeat(64)
const bridgeHeaders = { host: '127.0.0.1:8787', 'x-jarvis-token': token }
const emptyPolicy = { chrome: false, camera: false, allowedTools: new Set() }

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-security-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('HTTP and WebSocket require credentials, exact Host and frontend origin', () => {
  const allowed = (headers, ws = false) => bridgeRequestAllowed(req(headers), token, 8787, 5173, ws)
  assert.equal(allowed(bridgeHeaders), true)
  assert.equal(allowed({ host: bridgeHeaders.host }), false)
  assert.equal(allowed({ ...bridgeHeaders, 'x-jarvis-token': 'b'.repeat(64) }), false)
  assert.equal(allowed({ ...bridgeHeaders, host: 'attacker.example:8787' }), false)
  assert.equal(allowed({ ...bridgeHeaders, origin: 'https://attacker.example' }), false)
  assert.equal(allowed(bridgeHeaders, true), false)
  assert.equal(allowed({ ...bridgeHeaders, origin: 'http://localhost:5173' }, true), true)
  assert.equal(allowed({ ...bridgeHeaders, origin: 'http://localhost:5199' }, true), false)
  assert.equal(allowed({ ...bridgeHeaders, origin: 'null' }), false)
})

test('frontend refuses DNS rebinding, cross-site requests, other local ports and unpaired WS', () => {
  assert.equal(frontendRequestAllowed(req({ host: 'localhost:5173' }), 5173), true)
  for (const headers of [
    { host: 'evil.example:5173' },
    { host: 'localhost:5173', origin: 'http://localhost:5174' },
    { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' },
    { host: 'localhost:5173', origin: 'null' },
  ]) assert.equal(frontendRequestAllowed(req(headers), 5173), false)
  assert.equal(frontendRequestAllowed(req({ host: 'localhost:5173' }), 5173, true), false)
})

test('bridge auth is enforced on real HTTP requests', async (t) => {
  const server = createServer((r, s) => {
    const port = server.address().port
    const allowed = bridgeRequestAllowed(r, token, port, 5173)
    s.writeHead(allowed ? 200 : 403)
    s.end(allowed ? 'paired' : 'forbidden')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  assert.equal(server.address().address, '127.0.0.1')
  const call = (headers) => new Promise((resolve, reject) => {
    const r = request({ hostname: '127.0.0.1', port: server.address().port, path: '/file?path=/secret.png', headers }, (s) => {
      s.resume(); s.on('end', () => resolve(s.statusCode))
    })
    r.on('error', reject); r.end()
  })
  assert.equal(await call({}), 403)
  assert.equal(await call({ 'x-jarvis-token': token }), 200)
  assert.equal(await call({ 'x-jarvis-token': token, origin: 'https://evil.example' }), 403)
})

test('credential persists privately and rejects symlinks, loose permissions and corrupt tokens', (t) => {
  const root = temporary(t)
  const first = bridgeToken(root)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(bridgeToken(root), first)
  const path = join(root, 'bridge-token')
  chmodSync(path, 0o644)
  assert.throws(() => bridgeToken(root), /Unsafe/)
  chmodSync(path, 0o600)
  writeFileSync(path, 'short')
  assert.throws(() => bridgeToken(root), /Invalid/)
  rmSync(path)
  const other = join(root, 'other')
  writeFileSync(other, first, { mode: 0o600 })
  symlinkSync(other, path)
  assert.throws(() => bridgeToken(root))
})

test('MCP policy is empty by default, requires exact tools and never starts unselected servers', (t) => {
  const root = temporary(t)
  assert.deepEqual(Object.keys(loadPolicy({}, root).servers), [])
  writeFileSync(join(root, 'mcp.json'), JSON.stringify({
    servers: { search: { type: 'http', url: 'https://example.com/mcp' }, unused: { command: 'unsafe' } },
    allowedTools: ['mcp__search__search_public'],
  }))
  const policy = loadPolicy({}, root)
  assert.deepEqual(Object.keys(policy.servers), ['search'])
  assert.equal(decideTool('mcp__search__search_public', policy), true)
  assert.equal(decideTool('mcp__search__search_private', policy), false)
  assert.equal(decideTool('mcp__other__search_public', policy), false)
  for (const tool of ['Read', 'Bash', 'Write', 'Agent', 'ToolSearch', 'ReadMcpResource', 'mcp__exa__search', 'mcp__ccd_session__read']) {
    assert.equal(decideTool(tool, policy), false)
  }
  for (const override of ['JARVIS_ALLOW_WRITES', 'JARVIS_ALLOW_NO_ORIGIN']) {
    assert.throws(() => loadPolicy({ [override]: '1' }, root), /disabled/)
  }
  writeFileSync(join(root, 'mcp.json'), '{bad')
  assert.throws(() => loadPolicy({}, root))
})

test('wildcards, built-ins, reserved server names and unknown MCP namespaces fail closed', (t) => {
  const root = temporary(t)
  for (const cfg of [
    { servers: { search: {} }, allowedTools: ['mcp__search__*'] },
    { servers: { search: {} }, allowedTools: ['Bash'] },
    { servers: { search: {} }, allowedTools: ['mcp__other__read'] },
    { servers: { jarvis: {} }, allowedTools: [] },
    { servers: { x__y: {} }, allowedTools: [] },
  ]) {
    writeFileSync(join(root, 'mcp.json'), JSON.stringify(cfg))
    assert.throws(() => loadPolicy({}, root))
  }
})

test('Chrome/camera stay off; opt-in Chrome cannot navigate, type, click or inspect network', () => {
  assert.equal(decideTool('mcp__jarvis__display', emptyPolicy), true)
  assert.equal(decideTool('mcp__jarvis__new_tool', emptyPolicy), false)
  assert.equal(decideTool('mcp__jarvis_chrome__chrome_page_text', emptyPolicy), false)
  assert.equal(decideTool('mcp__jarvis_eyes__look', emptyPolicy), false)
  const enabled = { ...emptyPolicy, chrome: true, camera: true }
  assert.equal(decideTool('mcp__jarvis_chrome__chrome_page_text', enabled), true)
  assert.equal(decideTool('mcp__jarvis_eyes__look', enabled), true)
  for (const tool of ['chrome_navigate', 'chrome_click', 'chrome_type', 'chrome_form_input', 'chrome_network', 'chrome_console']) {
    assert.equal(decideTool(`mcp__jarvis_chrome__${tool}`, enabled), false)
  }
})

test('file containment excludes parents, prefix siblings and symlink escapes', (t) => {
  const root = temporary(t)
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const privateImage = join(root, 'secret.png')
  writeFileSync(privateImage, 'private')
  symlinkSync(privateImage, join(workspace, 'escape.png'))
  assert.equal(withinRoots(join(workspace, 'safe.png'), [workspace]), true)
  assert.equal(withinRoots(join(root, 'workspace-other', 'secret.png'), [workspace]), false)
  assert.equal(withinRoots(realpathSync(join(workspace, 'escape.png')), [workspace]), false)
  assert.equal(withinRoots(workspace, [workspace]), false)
})

test('media targets block private addresses, mapped IPv6 and unsafe schemes', () => {
  for (const ip of ['127.0.0.1', '10.0.0.2', '169.254.169.254', '192.168.1.1', '::1', '::ffff:7f00:1', 'fc00::1', 'fe80::1']) {
    assert.equal(blockedAddress(ip), true)
  }
  assert.equal(blockedAddress('8.8.8.8'), false)
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1', 'http://[::ffff:7f00:1]', 'http://router.local', 'https://u:p@example.com']) {
    assert.throws(() => vetTarget(url))
  }
})

test('invalid local ports are rejected', () => {
  assert.equal(portNumber(undefined, 5173), 5173)
  for (const port of ['0', '80', '65536', 'NaN', '5173.5']) assert.throws(() => portNumber(port, 5173))
})
