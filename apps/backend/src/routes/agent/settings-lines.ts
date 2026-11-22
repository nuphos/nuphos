import { isOpenAbProvider, runtimeLabel } from '@/lib/claude-code-preview/runtime-provider'

import { serializeTimelineEvents } from './conversation-timeline'
import { label, sentenceOf } from './settings-sentence'

import type { ConversationOwner } from './conversation-view'
import type { LineActor, Setting, Shown } from './settings-sentence'
import type {
  SettingsChange,
  SettingsChangeVia,
  SettingValue,
} from '@/lib/agent/db/settings-history'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

// How a conversation's settings changes read among its messages (#3699): who
// changed which settings, in the picker's names, one line per save or run of saves.

const PICKED = ['model', 'effort', 'fast'] as const
const MOVES = new Set<SettingsChangeVia>(['runtime_move', 'runtime_fallback'])

type Diff = { from?: SettingValue; to?: SettingValue }
export type SettingsAgent = { sessionId: string; title: string; provider?: OpenAbProvider }
export type SettingsLookup = {
  owners: Map<string, ConversationOwner>
  agents: Map<string, SettingsAgent>
}

/** A line as clients get it among `timelineEvents`. */
type TimelineLine = { kind: string; at: string; text: string } & Record<string, unknown>

/** A line before it is written out: one record, or consecutive ones by one actor. */
type Line = {
  at: Date
  key: string
  actor: LineActor
  form: 'set' | 'changed'
  diffs: Map<Setting, Diff>
  change: SettingsChange
  actingFor?: string
}

// No value, the runtime's "default", and fast mode off all mean the agent's own default.
const stock = (kind: Setting, value?: SettingValue) =>
  !value || value.value === 'default' || (kind === 'fast' && value.value === 'off')

/** The settings a record changed; one that went from the agent's default to it changed nothing. */
const diffsOf = (change: SettingsChange) =>
  new Map(
    PICKED.flatMap((kind) => {
      const diff = change[kind]

      return diff && !(stock(kind, diff.from) && stock(kind, diff.to))
        ? [[kind, diff] as const]
        : []
    }),
  )

/** The agent filled in values nobody picked, replacing nothing. */
const filledIn = (change: SettingsChange) =>
  (change.via === 'session_start' || change.via === 'runtime_reported') &&
  [...diffsOf(change).values()].every((diff) => !diff.from)

/** The line as one plain sentence, which the phone apps show as it is. */
const sentence = (line: Line) =>
  sentenceOf(line.actor, line.form, settingsOf(line.diffs), setValues(line.diffs))

const runtimeActor = (provider?: OpenAbProvider): LineActor =>
  provider
    ? { type: 'runtime', label: runtimeLabel(provider), provider }
    : { type: 'runtime', label: 'The runtime' }

function lineOf(
  change: SettingsChange,
  provider: OpenAbProvider | undefined,
  lookup: SettingsLookup,
): Line {
  const owner = lookup.owners.get(change.actorId)
  const agent = change.agentSessionId ? lookup.agents.get(change.agentSessionId) : undefined
  const reported = change.via === 'session_start' || change.via === 'runtime_reported'
  let actor: LineActor = {
    type: 'person',
    id: change.actorId,
    name: owner?.name ?? 'Someone',
    avatarURL: owner?.avatarURL ?? '',
  }

  if (change.actorId === 'system') actor = reported ? runtimeActor(provider) : { type: 'nuphos' }
  else if (change.agentSessionId)
    actor = {
      type: 'task',
      sessionId: change.agentSessionId,
      title: agent?.title ?? 'A Task',
      ...(agent?.provider ? { provider: agent.provider } : {}),
    }

  return {
    at: change.at,
    key: `${change.actorId} ${change.agentSessionId ?? ''} ${actor.type === 'runtime' ? actor.label : ''}`,
    actor,
    form: filledIn(change) ? 'set' : 'changed',
    diffs: diffsOf(change),
    change,
    ...(change.agentSessionId ? { actingFor: owner?.name ?? 'Someone' } : {}),
  }
}

// Claude Code's "Default" stands for a model and is not one: a change from it names no `from`.
const settingsOf = (diffs: Map<Setting, Diff>): Shown[] =>
  [...diffs].map(([setting, { from, to }]) => ({
    setting,
    ...(from && from.value !== 'default' ? { from } : {}),
    ...(to ? { to } : {}),
  }))

// What an agent filled in, as its chip names it: fast mode only when on.
const picked = (diffs: Map<Setting, Diff>) =>
  settingsOf(diffs).filter(({ setting, to }) => (setting === 'fast' ? to?.value === 'on' : to))
const setValues = (diffs: Map<Setting, Diff>) =>
  picked(diffs).map(({ setting, to }) =>
    setting === 'fast' ? 'fast mode on' : (label(setting, to) ?? ''),
  )

/** Each change with the kind of agent that ran the conversation when it happened. */
export function withProviders(changes: readonly SettingsChange[]) {
  let provider: OpenAbProvider | undefined

  return changes.map((change) => {
    const to = change.runtime?.to

    if (to) provider = isOpenAbProvider(to.provider) ? to.provider : undefined

    return { change, provider }
  })
}

/** One record as one plain sentence, for the API; undefined when it changed no setting. */
export function recordSentence(
  change: SettingsChange,
  provider: OpenAbProvider | undefined,
  lookup: SettingsLookup,
) {
  const line = lineOf(change, provider, lookup)

  return line.diffs.size ? sentence(line) : undefined
}

// A move keeps the line it has always had, which clients draw with the agents' icons.
function movedLine(change: SettingsChange, lookup: SettingsLookup) {
  const { from, to } = change.runtime ?? {}

  if (!to) return undefined

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
  )[0]
}

/** Two consecutive changes by one actor, with no message between them, as one net change. */
function merged(line: Line, next: Line): Line {
  const diffs = new Map(line.diffs)

  for (const [kind, diff] of next.diffs) {
    const before = diffs.get(kind)

    diffs.set(kind, before ? { ...before, to: diff.to } : diff)
  }

  // In the picker's order.
  return {
    ...line,
    at: next.at,
    diffs: new Map(
      PICKED.flatMap((kind) => {
        const diff = diffs.get(kind)

        return diff ? [[kind, diff] as const] : []
      }),
    ),
    change: next.change,
  }
}

const net = (diffs: Map<Setting, Diff>) =>
  new Map([...diffs].filter(([, diff]) => diff.from?.value !== diff.to?.value))

function settingsLine(line: Line) {
  const { change, actor } = line
  const diffs = line.form === 'set' ? line.diffs : net(line.diffs)

  if (line.form === 'set' ? !setValues(diffs).length : !diffs.size) return []
  const written = { ...line, diffs }

  return [
    {
      kind: 'settings_changed',
      at: line.at.toISOString(),
      text: sentence(written),
      by: actor,
      form: line.form,
      settings: settingsOf(diffs),
      ...(line.actingFor ? { actingFor: line.actingFor } : {}),
      via: change.via,
      ...(change.client ? { client: change.client } : {}),
      ...(change.agentSessionId ? { agentSessionId: change.agentSessionId } : {}),
    },
  ]
}

/**
 * The lines a conversation shows for its settings changes, among its messages.
 * A move keeps its runtime line, and what the new agent fills in right after
 * it goes on that line. What an agent fills in before it ever started over is
 * on the Task's chip already and shows nothing. Consecutive changes by one actor with no message
 * between them show as one net change, and none when they undo each other.
 */
export function settingsTimelineLines(
  changes: readonly SettingsChange[] = [],
  lookup: SettingsLookup,
  messageTimes: Date[] = [],
) {
  const quiet = (from: Date, to: Date) => !messageTimes.some((time) => time > from && time <= to)
  const out: (
    | {
        type: 'moved'
        change: SettingsChange
        line: NonNullable<ReturnType<typeof movedLine>>
        picks: Map<Setting, Diff>
      }
    | { type: 'settings'; line: Line }
  )[] = []
  // Until the agent starts over (a move, or a lost session), what it fills in is on the chip.
  let startedOver = false

  for (const { change, provider } of withProviders(changes)) {
    // Where a new Task starts, and the picks it starts with, are on the chip: neither is a change.
    if (change.via === 'placement' || change.via === 'new_chat') continue
    const last = out.at(-1)

    if (MOVES.has(change.via)) {
      const moved = movedLine(change, lookup)

      startedOver = true
      if (moved) out.push({ type: 'moved', change, line: moved, picks: new Map() })
      continue
    }
    if (change.via === 'session_lost') startedOver = true
    const line = lineOf(change, provider, lookup)

    if (line.form === 'set') {
      if (!startedOver) continue
      // The new agent reports its picks with the first turn after the move, past that turn's message.
      if (last?.type === 'moved') {
        for (const [kind, diff] of line.diffs) last.picks.set(kind, diff)
        continue
      }
    }
    if (
      last?.type === 'settings' &&
      last.line.form === 'changed' &&
      line.form === 'changed' &&
      last.line.key === line.key &&
      quiet(last.line.at, line.at)
    )
      last.line = merged(last.line, line)
    else out.push({ type: 'settings', line })
  }

  return out.flatMap((entry): TimelineLine[] => {
    if (entry.type === 'settings') return settingsLine(entry.line)
    const { line, picks, change } = entry

    return [
      {
        ...line,
        via: change.via,
        ...(change.client ? { client: change.client } : {}),
        ...(setValues(picks).length
          ? { picks: picked(picks), text: [line.text, ...setValues(picks)].join(' · ') }
          : {}),
      },
    ]
  })
}
