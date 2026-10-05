import type { ConversationOwner } from './conversation-view'
import type { ConversationTimelineEvent } from '@/lib/agent/db/shared'

export function timelineEventUserIds(events: readonly ConversationTimelineEvent[] = []): string[] {
  return events.flatMap((event) =>
    'targetId' in event ? [event.actorId, event.targetId] : [event.actorId],
  )
}

/**
 * The line both clients print, written here once so desktop and iOS cannot
 * phrase the same event differently. Names resolve at read time, so a renamed
 * teammate shows under their current name.
 */
export function serializeTimelineEvents(
  events: readonly ConversationTimelineEvent[] = [],
  ownerById: Map<string, ConversationOwner>,
): { kind: ConversationTimelineEvent['kind']; at: string; text: string }[] {
  const name = (id: string) => ownerById.get(id)?.name ?? 'Someone'

  return events.map((event) => {
    const actor = name(event.actorId)
    let text: string

    if (event.kind === 'runtime_moved')
      text = event.fromLabel
        ? `${actor} moved this session from ${event.fromLabel} to ${event.toLabel}`
        : `${actor} moved this session to ${event.toLabel}`
    else if (event.kind === 'participant_invited')
      text = `${actor} invited ${name(event.targetId)} into this session`
    else if (event.targetId === event.actorId) text = `${actor} left this session`
    else text = `${actor} removed ${name(event.targetId)} from this session`

    return { kind: event.kind, at: event.at.toISOString(), text }
  })
}
