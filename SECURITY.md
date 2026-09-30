# Security model and remaining limits

This fork reduces the capabilities exposed by a local voice assistant. It does not make untrusted Node code, the Claude SDK or an external MCP subprocess safe to run under your main user account. For stronger isolation, use a separate OS account or VM without personal documents and browser sessions.

## Controls

1. The bridge and frontend bind to IPv4 loopback only. Strict ports and exact Host checks reduce accidental LAN exposure and DNS rebinding. Browser requests from foreign origins or cross-site contexts are denied. WebSockets require an exact frontend origin.
2. Every bridge HTTP endpoint and WebSocket upgrade requires a random 256-bit credential. A private `.jarvis/bridge-token` file shares it between local Node processes; the Vite proxy injects it into upstream headers. It is not a VITE variable, browser cookie, URL parameter or WebSocket subprotocol. `.jarvis` and `.git` are denied by Vite's file server. Symlinked, publicly readable or malformed token files fail startup.
3. Claude built-ins are removed using `tools: []`. Global/project/plugin MCP discovery is disabled using `strictMcpConfig: true` and settings sources are empty. Both a PreToolUse hook and canUseTool callback enforce exact tool names. This avoids relying solely on callbacks that the CLI may skip after its own auto-approval.
4. External MCPs come only from `.jarvis/mcp.json`, default empty. Servers without selected tools are not started; unknown names and wildcards fail closed. Reserved internal namespaces cannot be supplied externally. This is an explicit capability selection, not automatic classification by tool names.
5. Chrome reading and agent vision are off by default. Chrome tool registration omits navigation, clicking, typing, form input, tab creation/deletion, console and network inspection. Camera blades also check the vision flag, so the display tool cannot bypass it.
6. Local image serving resolves real paths, checks file type/size and confines them to selected roots. The default root is the private project workspace, not the user's home or system temporary directories.
7. Direct Anthropic/ElevenLabs browser clients and embedded service/MCP credentials are removed. Legacy frontend credential variables cause Vite startup/build to fail. The optional Picovoice wake-word access key is an intentional browser provider credential, not a backend session secret.
8. Page previews use reader mode; the former live mode cannot make uncontrolled publisher subresource requests. Proxy requests retain DNS/redirect/private-address checks, byte limits and timeouts. Embedded YouTube/Vimeo content still connects to those services from the browser.
9. Claude session transcript persistence is disabled. Microphone capture for clap detection on page load is removed. Conversation still resides in the active session; camera and speech cloud processing remain explicit privacy considerations.

## Remaining trust boundaries

- Loopback and origin checks do not protect against malware running as the same OS user. Such software can read the token file, imitate a local client or access your Claude credentials directly. The frontend proxy intentionally authorizes local requests; it is not a user-login service.
- The SDK process still uses your Claude login. Its account usage, provider retention and other policies are unchanged. Authentication is necessary for inference; restricting tools does not turn inference into local computation.
- There is no kernel-enforced file sandbox. Removing file tools prevents model-directed file reads through those built-ins, but the Node process and any explicitly enabled MCP command retain their OS user permissions. A working directory is not a security boundary.
- A selected external tool can read, write or transmit whatever its implementation permits. The exact allowlist prevents unselected tool calls, not malicious behavior inside selected tools or at process startup. Only select reviewed, suitably scoped integrations; credentials should have minimum permissions.
- Read access can expose sensitive data. Enabling Chrome permits selected pages/screenshots to be returned to the model. Enabling vision permits camera frames. Extending file roots permits images from those directories to be served locally.
- Prompt injection remains possible in pages and tool results. The application-level restrictions reduce consequences; model instructions alone are not a guarantee. Public media/proxy requests still leave your computer and expose its outbound IP, and URLs can encode data. Do not provide sensitive information or add sensitive integrations on the assumption that the assistant cannot transmit it.
- DOMPurify and CSP protect the display in depth, but the application CSP retains development/voice runtime allowances such as unsafe-inline and unsafe-eval. This is a local development application, not a hardened publicly hosted service.
- An audit reporting zero known vulnerabilities is not a malware scan or proof of security. Installation uses `npm ci --ignore-scripts` to avoid dependency lifecycle scripts; keep the lockfile and re-audit updates. Native optional features may need separate verification on other platforms.

## Validation scope

The test suite exercises pure security policy, private token handling, file containment, SSRF target checks, actual SDK MCP tool registration, and real HTTP/WebSocket transport through Vite and the bridge. The agent is replaced only in transport tests: they exercise the real server code without reading login credentials, making model requests or starting external MCPs.

The suite does not validate model-level adherence, the actual authenticated Claude subprocess, microphone/camera hardware, full Kokoro model inference or third-party tools. These remain manual integration checks in an isolated environment.

Delete `.jarvis/bridge-token` while both servers are stopped to rotate the local credential. Never commit `.jarvis`, .env files, session credentials or personal workspace contents.
