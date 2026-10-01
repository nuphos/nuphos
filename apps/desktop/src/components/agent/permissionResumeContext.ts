import { createContext } from 'react'

// Provided by AgentPanel around the chat transcript. When an admin approves (or
// rejects) an inline permission-grant proposal that PAUSED the turn, the card
// calls this with the tool call's id and its new RESULT. Following the Vercel
// AI SDK human-in-the-loop pattern, we rewrite the paused tool call's output
// (addToolResult) — NOT inject a fake user message — then resume the turn so the
// model continues from the updated tool result. In surfaces with no paused turn
// (e.g. the Plans library) there is no provider, so it's null and the card just
// updates its own state.
export type PermissionResumeFn = (toolCallId: string, output: Record<string, unknown>) => void

export const PermissionResumeContext = createContext<PermissionResumeFn | null>(null)
