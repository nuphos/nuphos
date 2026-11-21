// What the fixture agent logged, one JSON line per entry, for scenarios to check.
import { readFileSync } from 'node:fs'

import type { Stack } from './stack.ts'

type AgentEntry = {
  /** The runtime it ran on: `first`, `second` or `codex`. */
  agent: string
  sessionId: string
  event: string
  marker?: string
  /** Every marker in a turn's prompt, in order. */
  markers?: string[]
  /** The model settings a new session was created with. */
  defaults?: { model?: string; effort?: string; fast?: string }
  /** The Bot-only Claude Code env a new session was created with. */
  env?: Record<string, string>
  /** A fresh session's history preamble: the prompt's length and what it says about omitted turns. */
  history?: { chars: number; omitted: boolean; readConversation: boolean }
  /** Whether the system prompt a session opened with tells it to delegate work (#4156). */
  delegates?: boolean
  /** The E2E_RULE:<name> the system prompt a session was loaded with names. */
  rule?: string
  /** Each system prompt section's start and hash, as the session opened or loaded with it. */
  sections?: string[]
  /** The response language a turn's prompt names. */
  language?: string
  isError?: boolean
  detail?: string
  /** How long a permission request took to be answered. */
  ms?: number
  /** E2E_CALL: the tool it called and that tool's answer. */
  name?: string
  result?: unknown
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

/** The first agent applied `model` to the session that ran the turn marked `marker`. */
export function firstAgentHolds(stack: Stack, marker: string, model: string) {
  const log = agentLog(stack)
  const session = log.find((entry) => entry.marker === marker)?.sessionId

  return log.some(
    (entry) =>
      entry.agent === 'first' &&
      entry.sessionId === session &&
      entry.event === 'setting' &&
      entry.detail === `model=${model}`,
  )
}
