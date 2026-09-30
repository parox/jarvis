# J.A.R.V.I.S. — restricted local fork

A voice assistant with the original React/Three.js interface and Claude Code as its brain. This fork limits network exposure and tool access. It is a restricted assistant, not an operating-system sandbox. See [SECURITY.md](SECURITY.md) before enabling integrations.

## What works

Voice conversation, interface controls, sanitised panels, guarded media and article previews. Claude inference runs on Anthropic's servers using your Claude Code login. Browser speech recognition can use the browser vendor's cloud service; optional ElevenLabs speech sends audio/text to ElevenLabs.

Shell commands, built-in file reading, subagents, direct browser API calls and unrestricted writes are disabled. Existing-tab Chrome reading and agent camera access are opt-in. The assistant cannot navigate Chrome or click/type/submit, even after enabling Chrome reading.

## Requirements and start

Use Node.js 20.19+ (or 22.12+) and an installed, authenticated Claude Code CLI. Open the interface in Chrome or Edge.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm start
```

Open `http://127.0.0.1:5173`, click INITIALISE, then grant microphone permission if desired. Loading the page no longer starts microphone capture for clap detection. Ctrl-C stops both local processes. No real Claude requests are made by the tests.

Both servers bind to `127.0.0.1`. The browser uses a same-origin `/bridge` proxy; only the Node processes know the private bridge token. A standalone static build cannot operate without this local proxy. To use the built frontend, start `npm run bridge` and `npm run preview` in separate terminals.

## Optional integrations

Export server settings in the shell **before** `npm start`. `.env.local` is for the non-secret frontend options in `.env.example`; server settings in that file are not loaded by the bridge.

- `PORT`: frontend port, default 5173. The port must be free; there is no automatic fallback.
- `JARVIS_BRIDGE_PORT`: backend port, default 8787.
- `JARVIS_MODEL` and `JARVIS_EFFORT`: Claude model and effort.
- `ELEVENLABS_API_KEY` and `JARVIS_VOICE_ID`: optional cloud speech; API credentials never enter the browser bundle.
- `JARVIS_ENABLE_CHROME=1`: permit reading existing tabs of your logged-in Chrome through its Claude extension. This can disclose private page contents to the model. Navigation, clicks, typing, network-response inspection and console inspection remain absent.
- `JARVIS_ENABLE_CAMERA=1`: permit the agent's camera tools and camera blade; frames are sent to the model. The browser/OS still controls camera permission. Pressing G for local gesture control is a separate explicit user action.
- `JARVIS_FILE_ROOTS`: comma-separated absolute directories for local image serving. This **replaces** the default `.jarvis/workspace` root; home and temporary directories are never added implicitly.

No servers are imported from your global Claude MCP configuration. For a reviewed MCP integration, create `.jarvis/mcp.json`:

```json
{
  "servers": {
    "search": {
      "type": "http",
      "url": "https://YOUR-REVIEWED-MCP-HOST/mcp"
    }
  },
  "allowedTools": ["mcp__search__search_public"]
}
```

Use the server's real tool name; the example is a placeholder. Tools must be individually listed, without wildcards. Only servers with selected tools are started. Tool names are not proof that a server is read-only: review the implementation before selecting one. Configuration and credentials under `.jarvis` are git-ignored and denied by the development file server.

`bridge:writes`, `--writes`, direct API mode, extra origins and unauthenticated socket overrides are deliberately unavailable. Search/image generation requires an explicitly configured tool. Account automations that send, delete or purchase are outside this fork's default scope.

## Validation

```sh
npm test
npm run lint
npm run build
npm audit --package-lock-only
```

Tests cover credentials/origins, private token files, MCP policy, file/symlink boundaries, camera gating, Chrome tool registration, and the real bridge/Vite HTTP and WebSocket path with a test-only agent simulator. They do not certify Claude model behavior, browser microphone/camera hardware or third-party MCP servers.

The lockfile updates known vulnerable dependencies, including DOMPurify and the transitive Sharp image decoder. A Sharp override selects the fixed 0.35.5+ line; retain the lockfile and recheck advisories when updating.

## Licence

MIT, inherited from the upstream project. Original audio credits and usage restrictions remain in `public/audio/CREDITS.md`.
