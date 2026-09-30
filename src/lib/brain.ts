import * as bridge from './bridge'
import type { AskHandlers, Msg } from './anthropic'
import type { Blade, Panel } from '../store'

export type { AskHandlers, Msg }
export type { ConnectionState } from './bridge'
export const usingBridge = true

/** Conversation state lives only in the active local bridge session. */
export async function ask(prompt: string, _history: Msg[], handlers: AskHandlers): Promise<{ text: string; tools: string[] }> {
  return bridge.ask(prompt, handlers)
}
export async function warm(): Promise<void> { await bridge.warmBridge() }
export function watchServers(fn: (servers: string[]) => void): void { bridge.watchServers(fn) }
export function watchPanels(fn: (panel: Panel) => void): void { bridge.watchPanels(fn) }
export function watchBlades(fn: (blade: Blade) => void): void { bridge.watchBlades(fn) }
export function watchUi(fn: (op: string, args: any) => void): void { bridge.watchUi(fn) }
export function watchCapture(fn: (req: bridge.CaptureRequest) => Promise<bridge.CaptureResult>): void { bridge.watchCapture(fn) }
export function cancel(): void { bridge.cancel() }
export function interrupt(): void { cancel() }
export function isConnected(): boolean { return bridge.isConnected() }
export function watchConnection(fn: (state: bridge.ConnectionState) => void): void { bridge.watchConnection(fn) }
export function connectedLabels(): string[] { return bridge.bridgeServers() }
