import type { RuntimeExecution } from './runtimeExecution.ts'

// Readers of open input requests (the session panel, the Inbox) reload as soon
// as something may have asked or answered a question: a request_user_decision
// call in a stream, a turn starting (a reply was delivered) or ending, a
// dismissal, a session starting or stopping. Their polls stay as the fallback.
const listeners = new Set<() => void>()
// Result frames carry no tool name; the call ids seen asking say which are questions.
const decisionCalls = new Set<string>()
// The backend records a question just after publishing its result frame.
const RECORDED_AFTER_MS = 1_000

export function refreshInputRequests(): void {
  for (const listener of listeners) listener()
}

export function onInputRequestsRefresh(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Providers may prefix MCP tools, as in `mcp__nuphos-tools__request_user_decision`. */
export function isDecisionToolName(name: unknown): boolean {
  return typeof name === 'string' && /(^|__|\.|\/)request_user_decision$/.test(name)
}

/** Reloads on a stream frame that can change the open questions. */
export function noteInputRequestFrame(frame: unknown) {
  if (!frame || typeof frame !== 'object') return
  const { type, toolCallId: id, toolName } = frame as Record<string, unknown>

  if (type === 'start' || type === 'finish') return refreshInputRequests()
  if (typeof id !== 'string') return
  if (
    (type === 'tool-input-start' || type === 'tool-input-available') &&
    isDecisionToolName(toolName)
  )
    decisionCalls.add(id)
  if (!decisionCalls.has(id)) return
  if (type === 'tool-input-available') refreshInputRequests()
  if (type === 'tool-output-available' || type === 'tool-output-error') {
    decisionCalls.delete(id)
    refreshInputRequests()
    setTimeout(refreshInputRequests, RECORDED_AFTER_MS)
  }
}

/** What of these sessions' runtime states can open or close a question. */
export function runtimeStatesKey(
  states: ReadonlyMap<string, RuntimeExecution>,
  sessionIds: readonly string[],
): string {
  return sessionIds
    .map((id) => {
      const state = states.get(id)

      if (!state) return `${id}:`
      const waiting = state.requestPending ? 'waiting' : ''

      return `${id}:${state.state}:${waiting}:${String(state.requests?.length ?? 0)}`
    })
    .join(',')
}
