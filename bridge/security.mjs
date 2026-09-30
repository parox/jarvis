import { randomBytes, timingSafeEqual } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
export const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const STATE_ROOT = join(PROJECT_ROOT, '.jarvis')
export const WORKSPACE = join(STATE_ROOT, 'workspace')
export function portNumber(value, fallback) {
  const port = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port')
  return port
}
export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())) throw new Error(`Expected a private, owned directory: ${path}`)
  return realpathSync(path)
}
// Shared only between local Node processes; never sent to the browser.
export function bridgeToken(root = STATE_ROOT) {
  privateDirectory(root)
  const path = join(root, 'bridge-token')
  try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
  catch (err) { if (err.code !== 'EEXIST') throw err }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('Unsafe bridge token file')
    const token = readFileSync(fd, 'utf8')
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid bridge token')
    return token
  } finally { closeSync(fd) }
}
export function localOrigins(port) { return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]) }
export function frontendRequestAllowed(req, port, websocket = false) {
  if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(req.headers.host)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin && !localOrigins(port).has(origin)) return false
  return !websocket || Boolean(origin)
}
export function bridgeRequestAllowed(req, token, port, frontendPort, websocket = false) {
  if (req.headers.host !== `127.0.0.1:${port}`) return false
  const supplied = req.headers['x-jarvis-token']
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return false
  const origin = req.headers.origin
  return (!websocket && !origin) || localOrigins(frontendPort).has(origin)
}
export function withinRoots(real, roots) {
  return roots.some((root) => {
    const rel = relative(root, real)
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)
  })
}
const UI_TOOLS = new Set(['display', 'blade', 'probe_url'])
const CHROME_TOOLS = new Set(['chrome_status', 'chrome_tabs', 'chrome_read_page', 'chrome_page_text', 'chrome_find', 'chrome_screenshot', 'chrome_scroll'])
const THEME_TOOLS = new Set(['ui_theme', 'ui_reactor', 'ui_orbit', 'ui_chrome', 'ui_effect', 'ui_screen', 'ui_reset'])
export function decideTool(name, policy) {
  if (typeof name !== 'string') return false
  if (name.startsWith('mcp__jarvis__')) return UI_TOOLS.has(name.slice('mcp__jarvis__'.length))
  if (name.startsWith('mcp__jarvis_ui__')) return THEME_TOOLS.has(name.slice('mcp__jarvis_ui__'.length))
  if (name.startsWith('mcp__jarvis_chrome__')) return policy.chrome && CHROME_TOOLS.has(name.slice('mcp__jarvis_chrome__'.length))
  if (name.startsWith('mcp__jarvis_eyes__')) return policy.camera && ['look', 'watch'].includes(name.slice('mcp__jarvis_eyes__'.length))
  return policy.allowedTools.has(name)
}
export function loadPolicy(env = process.env, root = STATE_ROOT) {
  if (env.JARVIS_ALLOW_WRITES === '1' || env.JARVIS_ALLOW_NO_ORIGIN === '1' || env.JARVIS_ALLOWED_ORIGINS) throw new Error('Legacy permission overrides are disabled in this fork')
  let cfg = { servers: {}, allowedTools: [] }
  try { cfg = JSON.parse(readFileSync(join(root, 'mcp.json'), 'utf8')) }
  catch (err) { if (err.code !== 'ENOENT') throw err }
  if (!cfg.servers || typeof cfg.servers !== 'object' || Array.isArray(cfg.servers) || !Array.isArray(cfg.allowedTools)) throw new Error('Invalid .jarvis/mcp.json policy')
  const servers = cfg.servers
  for (const name of Object.keys(servers)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || name.includes('__') || name.startsWith('jarvis')) throw new Error('Invalid or reserved MCP server name')
  }
  const allowedTools = new Set()
  for (const name of cfg.allowedTools) {
    const match = typeof name === 'string' && /^mcp__([a-z][a-z0-9_-]*)__([a-zA-Z0-9_-]+)$/.exec(name)
    if (!match || !Object.hasOwn(servers, match[1])) throw new Error('Use exact tool names from an explicitly configured server')
    allowedTools.add(name)
  }
  const selected = Object.fromEntries(Object.entries(servers).filter(([name]) => [...allowedTools].some((tool) => tool.startsWith(`mcp__${name}__`))))
  return { servers: selected, allowedTools, chrome: env.JARVIS_ENABLE_CHROME === '1', camera: env.JARVIS_ENABLE_CAMERA === '1' }
}
