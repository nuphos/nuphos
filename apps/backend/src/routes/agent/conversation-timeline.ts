import type { ConversationOwner } from './conversation-view'
import type { ConversationTimelineEvent } from '@/lib/agent/db/shared'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

type Person = { id: string; name: string; avatarURL: string }
type Runtime = { label: string; provider?: OpenAbProvider }

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
    const actor = person(event.actorId)
    const at = event.at.toISOString()

    if (event.kind === 'runtime_moved') {
      const from: Runtime | undefined = event.fromLabel
        ? { label: event.fromLabel, provider: event.fromProvider }
        : undefined
      const to: Runtime = { label: event.toLabel, provider: event.toProvider }
      const text = from
        ? `${actor.name} moved this session from ${from.label} to ${to.label}`
        : `${actor.name} moved this session to ${to.label}`

      return { kind: event.kind, at, text, actor, from, to }
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
