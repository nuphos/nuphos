import { BOOKKEEPING_TOOL_NAMES } from './toolRuns.ts'

import type { Part } from './parts.ts'

// The agent runtime sends this placeholder for any turn that ended without
// reply text, stopped or not. It is not an answer, so it never renders as one.
const NO_RESPONSE_PLACEHOLDER = /^_?\(no response\)_?$/

function isNoResponsePlaceholder(part: Part): boolean {
  return part.type === 'text' && NO_RESPONSE_PLACEHOLDER.test(part.text.trim())
}

/** The turn's parts without the runtime's "(no response)" placeholder. */
export function withoutNoResponsePlaceholder(parts: Part[]): Part[] {
  return parts.some(isNoResponsePlaceholder)
    ? parts.filter((part) => !isNoResponsePlaceholder(part))
    : parts
}

/**
 * The tool calls a turn the user stopped had made, or null when the user did
 * not stop it. A backend interruption notice already explains its own ending.
 */
export function stoppedTurnCalls(parts: Part[], stoppedByUser?: boolean): number | null {
  if (stoppedByUser !== true || parts.some((part) => part.type === 'turn-interrupted')) {
    return null
  }

  return parts.filter((part) => part.type === 'tool' && !BOOKKEEPING_TOOL_NAMES.has(part.toolName))
    .length
}
