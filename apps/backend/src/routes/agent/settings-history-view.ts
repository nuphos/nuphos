import { agentConversations } from '@/lib/agent/db/shared'

import { serializeTimelineEvents } from './conversation-timeline'

import type { ConversationOwner } from './conversation-view'
import type {
  SettingsChange,
  SettingsChangeVia,
  SettingValue,
} from '@/lib/agent/db/settings-history'
import type { AgentConversation } from '@/lib/agent/db/shared'

const PICKED = ['model', 'effort', 'fast'] as const
const LABEL = { model: 'model', effort: 'effort', fast: 'fast mode' }
const CLIENT: Record<string, string> = {
  desktop: 'Desktop',
  ios: 'iOS',
  android: 'Android',
  web: 'web app',
  cli: 'CLI',
  api: 'API',
}
// What made a change no person asked for.
const CAUSE: Partial<Record<SettingsChangeVia, string>> = {
  runtime_fallback: 'after a fallback move',
  session_lost: 'when the agent lost the session',
  placement: 'when the conversation was placed',
}

type Diff = { from?: SettingValue; to?: SettingValue }
type Agent = { sessionId: string; title: string }

const shown = (value: SettingValue) => value.name ?? value.value
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function changed(kind: (typeof PICKED)[number], { from, to }: Diff) {
  if (!to) return `${LABEL[kind]} back to the agent’s default (was ${from ? shown(from) : '-'})`

  return from
    ? `${LABEL[kind]} from ${shown(from)} to ${shown(to)}`
    : `${LABEL[kind]} to ${shown(to)}`
}

function started(kind: (typeof PICKED)[number], diff: Diff) {
  const now = diff.to ? `${LABEL[kind]} ${shown(diff.to)}` : `the agent’s default ${LABEL[kind]}`

  return diff.from ? `${now} instead of ${shown(diff.from)}` : now
}

/** The whole record as one plain line. */
function sentence(change: SettingsChange, person?: string, agent?: Agent) {
  const diffs = PICKED.flatMap((kind) => {
    const diff = change[kind]

    return diff ? [{ kind, diff }] : []
  })

  // A session that names its settings only after its first turn reports them as the agent's.
  const first = diffs.every(({ diff }) => !diff.from)

  if (change.via === 'session_start' || (change.via === 'runtime_reported' && first))
    return `The session started with ${diffs.map(({ kind, diff }) => started(kind, diff)).join(', ')}`
  const list = diffs.map(({ kind, diff }) => changed(kind, diff)).join(', ')

  if (change.actorId === 'system')
    return change.via === 'runtime_reported'
      ? `The agent changed its ${list}`
      : `${capital(list)} ${CAUSE[change.via] ?? ''}`.trim()
  const who = agent ? `${agent.title} (for ${person ?? 'Someone'})` : (person ?? 'Someone')
  const where = change.client ? (CLIENT[change.client] ?? change.client) : change.via

  return `${who} changed the ${list} · ${where}`
}

/** The agents that made changes, by session id, with their current names. */
export async function settingsAgents(changes: readonly SettingsChange[] = []) {
  const ids = [...new Set(changes.flatMap((change) => change.agentSessionId ?? []))]
  const docs = ids.length
    ? await agentConversations()
        .find({ sessionId: { $in: ids } }, { projection: { sessionId: 1, title: 1 } })
        .toArray()
    : []

  return new Map(docs.map((doc) => [doc.sessionId, { sessionId: doc.sessionId, title: doc.title }]))
}

export const settingsUserIds = (changes: readonly SettingsChange[] = []) =>
  changes.flatMap((change) => (change.actorId === 'system' ? [] : [change.actorId]))

type Lookup = { owners: Map<string, ConversationOwner>; agents: Map<string, Agent> }

function actorOf(change: SettingsChange, { owners, agents }: Lookup) {
  if (change.actorId === 'system') return { type: 'system' as const }
  const owner = owners.get(change.actorId)
  const agent = change.agentSessionId ? agents.get(change.agentSessionId) : undefined

  return {
    type: change.agentSessionId ? ('agent' as const) : ('user' as const),
    userId: change.actorId,
    name: owner?.name ?? 'Someone',
    ...(change.agentSessionId
      ? { agentSessionId: change.agentSessionId, ...(agent ? { agentTitle: agent.title } : {}) }
      : {}),
  }
}

/** The API's records, oldest first: every settings change, and moves recorded before them. */
export function serializeSettingsHistory(
  conversation: Pick<AgentConversation, 'settingsHistory' | 'timelineEvents'>,
  lookup: Lookup,
) {
  const legacy = (conversation.timelineEvents ?? []).flatMap((event) =>
    event.kind === 'runtime_moved'
      ? [
          {
            at: event.at.toISOString(),
            actor: event.reason
              ? { type: 'system' as const }
              : {
                  type: 'user' as const,
                  userId: event.actorId,
                  name: lookup.owners.get(event.actorId)?.name ?? 'Someone',
                },
            via: event.reason ? ('runtime_fallback' as const) : ('runtime_move' as const),
            ...(event.reason ? { reason: event.reason } : {}),
            runtime: {
              ...(event.fromLabel
                ? { from: { label: event.fromLabel, provider: event.fromProvider } }
                : {}),
              to: { label: event.toLabel, provider: event.toProvider },
            },
          },
        ]
      : [],
  )
  const recorded = (conversation.settingsHistory ?? []).map((change) => {
    const { at, actorId: _actorId, agentSessionId: _agent, ...rest } = change

    return {
      ...rest,
      at: at.toISOString(),
      actor: actorOf(change, lookup),
      text: lineText(change, lookup),
    }
  })

  return [...legacy, ...recorded].sort((a, b) => a.at.localeCompare(b.at))
}

function lineText(change: SettingsChange, { owners, agents }: Lookup) {
  const person = change.actorId === 'system' ? undefined : owners.get(change.actorId)?.name
  const agent = change.agentSessionId ? agents.get(change.agentSessionId) : undefined

  return sentence(change, person, agent)
}

// A move keeps the line it has always had, which clients draw with the agents' icons.
function movedLine(change: SettingsChange, lookup: Lookup) {
  const { from, to } = change.runtime ?? {}

  if (!to || change.via === 'placement') return []

  return serializeTimelineEvents(
    [
      {
        kind: 'runtime_moved',
        at: change.at,
        actorId: change.actorId,
        ...(from ? { fromLabel: from.label ?? from.id, fromProvider: from.provider } : {}),
        toLabel: to.label ?? to.id,
        toProvider: to.provider,
        ...(change.reason ? { reason: change.reason } : {}),
        ...(change.retrying ? { retrying: true as const } : {}),
      },
    ],
    lookup.owners,
  )
}

function settingsLine(change: SettingsChange, lookup: Lookup) {
  const picked = PICKED.flatMap((kind) => (change[kind] ? [[kind, change[kind]] as const] : []))

  if (!picked.length) return []
  const actor = actorOf(change, lookup)

  return [
    {
      kind: 'settings_changed',
      at: change.at.toISOString(),
      text: lineText(change, lookup),
      ...(actor.type === 'system'
        ? {}
        : {
            actor: {
              id: actor.userId,
              name: actor.name,
              avatarURL: lookup.owners.get(actor.userId)?.avatarURL ?? '',
            },
          }),
      ...Object.fromEntries(picked),
    },
  ]
}

/**
 * The lines a conversation shows for its settings changes. A move keeps its
 * runtime line; model, effort and fast mode get a settings line. The first
 * agent a conversation is placed on is no change and shows nothing.
 */
export function settingsTimelineLines(changes: readonly SettingsChange[] = [], lookup: Lookup) {
  return changes.flatMap((change) => {
    const source = {
      via: change.via,
      ...(change.client ? { client: change.client } : {}),
      ...(change.agentSessionId ? { agentSessionId: change.agentSessionId } : {}),
    }

    return [...movedLine(change, lookup), ...settingsLine(change, lookup)].map((line) => ({
      ...line,
      ...source,
    }))
  })
}
