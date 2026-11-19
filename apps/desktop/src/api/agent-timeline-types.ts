import type { AgentProvider } from '../types/runtime.ts'

export type AgentTimelinePerson = { id: string; name: string; avatarURL: string }
export type AgentTimelineRuntime = { label: string; provider?: AgentProvider }

/** A setting's change, each value as the runtime names it; an absent value is the default. */
export type AgentTimelineSetting = {
  setting: 'model' | 'effort' | 'fast'
  from?: { value: string; name?: string }
  to?: { value: string; name?: string }
}

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
  /** settings_changed: who changed the settings, a person, a Task acting for one, the agent, or Nuphos. */
  by?:
    | ({ type: 'person' } & AgentTimelinePerson)
    | { type: 'task'; sessionId: string; title: string; provider?: AgentProvider }
    | ({ type: 'runtime' } & AgentTimelineRuntime)
    | { type: 'nuphos' }
  /** settings_changed: `set` when the agent filled in values nobody picked. */
  form?: 'set' | 'changed'
  /** settings_changed: each setting, as the picker names it; an absent value is the default. */
  settings?: AgentTimelineSetting[]
  /** settings_changed: the person a Task acted for. */
  actingFor?: string
  /** settings_changed: where it came from (`picker`, `update_thread`, …) and the app that sent it. */
  via?: string
  client?: string
  /** runtime_moved: what the new agent picked right after the move. */
  picks?: AgentTimelineSetting[]
}
