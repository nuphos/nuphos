import type { AgentProvider } from '../types/runtime.ts'

export type AgentTimelinePerson = { id: string; name: string; avatarURL: string }
export type AgentTimelineRuntime = { label: string; provider?: AgentProvider }

/** Who joined, left or moved the session; `text` is the whole line, plain. */
export type AgentTimelineEvent = {
  kind: string
  at: string
  text: string
  /** agents_paused: the turn budget the channel's agents used up. */
  turns?: number
  actor?: AgentTimelinePerson
  target?: AgentTimelinePerson
  from?: AgentTimelineRuntime
  to?: AgentTimelineRuntime
  /** Set when a fallback moved the session: its agent was low on usage, unreachable, or failed a turn. */
  reason?: 'quota' | 'offline' | 'failure'
  retrying?: boolean // runtime_moved: the turn that failed before the move runs again on `to`
  /** A fallback that found no agent: each one passed over, and why. */
  skipped?: { label: string; reason: string }[]
  /** message_edited / conversation_forked: the destination session. */
  forkSessionId?: string
}
