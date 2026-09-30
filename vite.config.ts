import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { bridgeToken, frontendRequestAllowed, portNumber, PROJECT_ROOT } from './bridge/security.mjs'

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, PROJECT_ROOT, ''), ...process.env }
  const frontendOptions = new Set(['VITE_TTS_ENGINE', 'VITE_KOKORO_VOICE', 'VITE_USE_ELEVENLABS', 'VITE_PICOVOICE_ACCESS_KEY'])
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('VITE_') && value && !frontendOptions.has(key)) {
      throw new Error(`Unsupported frontend variable ${key}; keep service credentials on the bridge`)
    }
  }
  const port = portNumber(process.env.PORT, 5173)
  const bridgePort = portNumber(process.env.JARVIS_BRIDGE_PORT, 8787)
  const token = command === 'serve' ? bridgeToken() : ''
  const guardMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!frontendRequestAllowed(req, port)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    next()
  }
  const guard: Plugin = {
    name: 'jarvis-local-request-guard',
    configureServer(server) { server.middlewares.use(guardMiddleware) },
    configurePreviewServer(server) { server.middlewares.use(guardMiddleware) },
  }
  const proxy: ProxyOptions = {
    target: `http://127.0.0.1:${bridgePort}`,
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/bridge/, ''),
    configure(proxyServer) {
      proxyServer.on('proxyReq', (proxyReq) => { proxyReq.setHeader('x-jarvis-token', token) })
      proxyServer.on('proxyReqWs', (proxyReq, req, socket) => {
        // Upgrade requests bypass HTTP middleware.
        if (!frontendRequestAllowed(req, port, true)) {
          proxyReq.destroy()
          socket.destroy()
          return
        }
        proxyReq.setHeader('x-jarvis-token', token)
      })
    },
  }
  const localServer = {
    host: '127.0.0.1', port, strictPort: true, cors: false,
    fs: { strict: true, allow: [PROJECT_ROOT], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.jarvis/**', '**/.git/**'] },
    proxy: { '^/bridge(?:/|\\?|$)': proxy },
  }
  return {
    plugins: [react(), guard], server: localServer, preview: localServer,
    optimizeDeps: { exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'] },
  }
})
