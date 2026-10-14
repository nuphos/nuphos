// Kept free of UI imports so node tests can load it.
import type { ToolPart } from './parts.ts'

export const INTERRUPTED_TOOL_MESSAGE = 'Interrupted before the tool finished.'
// A tool call whose input never finished streaming (`input-streaming`) never
// fully materialized — the model stalled mid-emission and the silence watchdog
// aborted the turn. Distinguish it from a complete tool call that started and
// got interrupted, which "Interrupted before the tool finished" implies.
// A call still waiting on (or declined at) approval when the user stopped the
// turn never ran.
export const NOT_RUN_TOOL_MESSAGE = 'Stopped before the tool ran.'
export const INCOMPLETE_TOOL_MESSAGE = "The model didn't finish generating this tool call."

// Refine the generic interrupted message per tool-part state; leave explicit
// reasons (Stopped by user, a stream error) untouched.
export function incompleteToolErrorText(part: ToolPart, errorText: string): string {
  if (errorText !== INTERRUPTED_TOOL_MESSAGE) return errorText

  return part.state === 'input-streaming' ? INCOMPLETE_TOOL_MESSAGE : INTERRUPTED_TOOL_MESSAGE
}
