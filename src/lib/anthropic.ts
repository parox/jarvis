// Shared conversation types. There is no browser API client in this fork.
export type Msg = { role: 'user' | 'assistant'; content: string }
export type AskHandlers = { onText: (delta: string) => void; onTool: (name: string) => void }
