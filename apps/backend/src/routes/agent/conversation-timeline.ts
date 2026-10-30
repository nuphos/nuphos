import type { ConversationOwner } from './conversation-view'
import type { ConversationTimelineEvent } from '@/lib/agent/db/shared'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

type Person = { id: string; name: string; avatarURL: string }
type Runtime = { label: string; provider?: OpenAbProvider }

const FALLBACK_CAUSE = {
  quota: (from: string) => `${from} was low on usage`,
  offline: (from: string) => `${from} was unreachable`,
  failure: (from: string) => `${from} failed a turn`,
}

export function timelineEventUserIds(events: readonly ConversationTimelineEvent[] = []): string[] {
  return events.flatMap((event) =>
    'targetId' in event ? [event.actorId, event.targetId] : [event.actorId],
  )
}

/**
 * Each event with the people and agents it names, plus the whole line as
 * `text` for clients that print it plainly. Names resolve at read time, so a
 * renamed teammate shows under their current name.
 */
export function serializeTimelineEvents(
  events: readonly ConversationTimelineEvent[] = [],
  ownerById: Map<string, ConversationOwner>,
) {
  const person = (id: string): Person => {
    const owner = ownerById.get(id)

    return { id, name: owner?.name ?? 'Someone', avatarURL: owner?.avatarURL ?? '' }
  }

  return events.map((event) => {
    const at = event.at.toISOString()

    // No one did this: the channel's loop guard did.
    if (event.kind === 'agents_paused')
      return {
        kind: event.kind,
        at,
        turns: event.turns,
        text: `Agents paused after ${String(event.turns)} replies to each other. They pick up again when someone posts.`,
      }
    const actor = person(event.actorId)

    if (event.kind === 'runtime_moved') {
      const from: Runtime | undefined = event.fromLabel
        ? { label: event.fromLabel, provider: event.fromProvider }
        : undefined
      const to: Runtime = { label: event.toLabel, provider: event.toProvider }
      const reason = event.reason
      const text =
        reason && from
          ? `${FALLBACK_CAUSE[reason](from.label)}, so this session moved to ${to.label}`
          : from
            ? `${actor.name} moved this session from ${from.label} to ${to.label}`
            : `${actor.name} moved this session to ${to.label}`

      return { kind: event.kind, at, text, actor, from, to, ...(reason ? { reason } : {}) }
    }
    if (event.kind === 'runtime_fallback_stopped') {
      const passed = event.skipped.map((entry) => `${entry.label} (${entry.reason})`).join(', ')
      const text = passed
        ? `No agent in the fallback list could take this session: ${passed}`
        : 'No other agent in the fallback list could take this session'

      return { kind: event.kind, at, text, actor, skipped: event.skipped }
    }
    const target = person(event.targetId)
    let text: string

    if (event.kind === 'participant_invited')
      text = `${actor.name} invited ${target.name} into this session`
    else if (event.targetId === event.actorId) text = `${actor.name} left this session`
    else text = `${actor.name} removed ${target.name} from this session`

    return { kind: event.kind, at, text, actor, target }
  })
}
