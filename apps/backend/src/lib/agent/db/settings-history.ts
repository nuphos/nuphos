import { storedPick } from '@/lib/claude-code-preview/session-config-options'

import { agentConversations, liveAttachment } from './shared'

import type { AgentConversation } from './shared'
import type { RuntimeFallbackReason } from './timeline-events'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'
import type { Filter, UpdateFilter } from 'mongodb'

/** Where a change came from. */
export type SettingsChangeVia =
  /** The model picker in an app, or a call to its route. */
  | 'picker'
  /** The settings a new chat's first turn was sent with. */
  | 'new_chat'
  | 'update_thread'
  /** A thread starting on its parent's settings or on the ones it was given. */
  | 'create_thread'
  /** The MCP session update tool. */
  | 'mcp_update'
  | 'trigger'
  /** An MCP `ask` starting a conversation. */
  | 'mcp_ask'
  /** A person moving the conversation to another agent. */
  | 'runtime_move'
  /** A move down the fallback list; `reason` says why. */
  | 'runtime_fallback'
  /** The conversation's first agent, stamped when its first turn placed it. */
  | 'placement'
  /** What the agent ran with once it opened a session, defaults included. */
  | 'session_start'
  /** The agent changed a setting on its own between turns. */
  | 'runtime_reported'
  /** The agent lost the session; the next one starts from its settings. */
  | 'session_lost'
  /** Its owner started the Bot fresh; its next session starts from its settings. */
  | 'fresh_start'

/** Who changed the settings, and how. `actorId` is a user id, or 'system'. */
export type SettingsChangeBy = {
  actorId: string
  /** Set when an agent made the change, acting for `actorId`. */
  agentSessionId?: string
  via: SettingsChangeVia
  /** The app or MCP client that sent it, e.g. `desktop`, `ios`, `web`. */
  client?: string
  /** A fallback's reason. */
  reason?: RuntimeFallbackReason
  /** A fallback that runs the failed turn again on the new agent. */
  retrying?: true
}

export type SettingValue = { value: string; name?: string }
export type SettingsRuntime = { id: string; label?: string; provider?: OpenAbProvider }
type Diff<T> = { from?: T; to?: T }
const PICKED = ['model', 'effort', 'fast'] as const

export type SettingsChanges = {
  runtime?: Diff<SettingsRuntime>
  model?: Diff<SettingValue>
  effort?: Diff<SettingValue>
  fast?: Diff<SettingValue>
}
/** One change of a conversation's agent, model, effort or fast mode. Never removed. */
export type SettingsChange = SettingsChangeBy & SettingsChanges & { at: Date }

type SettingsDoc = Pick<
  AgentConversation,
  | 'sessionId'
  | 'runtimeId'
  | 'runtimeLabel'
  | 'agentRuntime'
  | 'claudeCodePreview'
  | 'initialSessionConfig'
>
type Settings = {
  runtime?: SettingsRuntime
  model?: SettingValue
  effort?: SettingValue
  fast?: SettingValue
}

/** What a conversation runs on and with, as its chip shows it. */
export function conversationSettings(doc: SettingsDoc): Settings {
  const attachment = liveAttachment(doc)
  const pick = attachment ? storedPick(attachment) : (doc.initialSessionConfig ?? {})
  const settings: Settings = doc.runtimeId
    ? {
        runtime: {
          id: doc.runtimeId,
          ...(doc.runtimeLabel ? { label: doc.runtimeLabel } : {}),
          ...(doc.agentRuntime ? { provider: doc.agentRuntime } : {}),
        },
      }
    : {}

  for (const kind of PICKED) {
    const value = pick[kind]

    if (!value) continue
    const name = attachment?.sessionConfig
      ?.find((option) => option.kind === kind)
      ?.options.find((choice) => choice.value === value)?.name

    settings[kind] = { value, ...(name && name !== value ? { name } : {}) }
  }

  return settings
}

/** The fields whose value differs; null when none does. Names alone are no change. */
export function settingsChanges(before: Settings, after: Settings): SettingsChanges | null {
  const changes: SettingsChanges = {}

  if (before.runtime?.id !== after.runtime?.id)
    changes.runtime = {
      ...(before.runtime ? { from: before.runtime } : {}),
      ...(after.runtime ? { to: after.runtime } : {}),
    }
  for (const kind of PICKED)
    if (before[kind]?.value !== after[kind]?.value)
      changes[kind] = {
        ...(before[kind] ? { from: before[kind] } : {}),
        ...(after[kind] ? { to: after[kind] } : {}),
      }

  return Object.keys(changes).length ? changes : null
}

// The update as Mongo would apply it, for the paths settings live on.
function applied<T extends object>(doc: T, update: UpdateFilter<AgentConversation>): T {
  const next = structuredClone(doc) as Record<string, unknown>
  const at = (path: string) => {
    const parts = path.split('.')
    const key = parts.pop() ?? path
    let parent = next

    for (const part of parts) {
      parent[part] ??= {}
      parent = parent[part] as Record<string, unknown>
    }

    return { parent, key }
  }

  for (const [path, value] of Object.entries(update.$set ?? {})) {
    const { parent, key } = at(path)

    parent[key] = structuredClone(value)
  }
  for (const path of Object.keys(update.$unset ?? {})) {
    const { parent, key } = at(path)

    Reflect.deleteProperty(parent, key)
  }

  return next as T
}

const ATTEMPTS = 5

/**
 * The one way to write a conversation's agent, model, effort or fast mode. A
 * write that changes any of them records who made it and how, in the same
 * update, so a setting cannot change without its record. The revision it read
 * guards the write; a concurrent change makes it read again.
 */
export async function updateConversationSettings(
  filter: Filter<AgentConversation>,
  update: UpdateFilter<AgentConversation>,
  by: SettingsChangeBy,
): Promise<{ matchedCount: number }> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const doc = await agentConversations().findOne(filter)

    if (!doc) return { matchedCount: 0 }
    const changes = settingsChanges(
      conversationSettings(doc),
      conversationSettings(applied(doc, update)),
    )
    const result = await agentConversations().updateOne(
      { ...filter, settingsRevision: doc.settingsRevision ?? { $exists: false } },
      {
        ...update,
        $inc: { settingsRevision: 1 },
        ...(changes
          ? {
              $push: {
                ...update.$push,
                settingsHistory: { at: new Date(), ...by, ...changes },
              },
            }
          : {}),
      },
    )

    if (result.matchedCount) return result
  }
  throw new Error('The conversation’s settings kept changing; this change was not written.')
}
