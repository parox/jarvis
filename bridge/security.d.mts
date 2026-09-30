import type { IncomingMessage } from 'node:http'
export const PROJECT_ROOT: string
export const STATE_ROOT: string
export function bridgeToken(root?: string): string
export function portNumber(value: string | undefined, fallback: number): number
export function frontendRequestAllowed(req: IncomingMessage, port: number, websocket?: boolean): boolean
