// What the fixture agent logged, one JSON line per entry, for scenarios to check.
import { readFileSync } from 'node:fs'

import type { Stack } from './stack.ts'

type AgentEntry = {
  /** The runtime it ran on: `first` or `second`. */
  agent: string
  sessionId: string
  event: string
  marker?: string
  /** The model settings a new session was created with. */
  defaults?: { model?: string; fast?: string }
  isError?: boolean
  detail?: string
}

export function agentLog(stack: Stack): AgentEntry[] {
  return readFileSync(stack.acpLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentEntry)
}

/** What the fixture agent did, in order: `opening` a session, or `start`, `finish`, `cancelled` or `asked` with the turn's marker. */
export function agentEvents(stack: Stack): string[] {
  return agentLog(stack).map(({ event, marker }) => (marker ? `${event} ${marker}` : event))
}

/** The turn a delegated Task ran, once it has finished. A refused create_thread throws its reason. */
export function delegatedTurn(stack: Stack, marker: string): AgentEntry | undefined {
  const log = agentLog(stack)
  const refusal = log.find((entry) => entry.event === 'delegated' && entry.isError)

  if (refusal) throw new Error(`create_thread was refused: ${refusal.detail ?? ''}`)

  return log.find((entry) => entry.event === 'finish' && entry.marker === marker)
}
