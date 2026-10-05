import type { AgentTimelineEvent } from '../../../api/agent-types'

/**
 * Where the session's timeline events sit among its loaded messages: each goes
 * right before the first message newer than it, or after the last one. A
 * message still streaming has no time yet and counts as the newest. An event
 * older than the first loaded message stays out while earlier history is
 * unloaded — it may belong further back, and shows once that page arrives.
 */
export function placeTimelineEvents(
  messages: readonly { id: string; createdAt?: number }[],
  events: readonly AgentTimelineEvent[] = [],
  hasEarlier = false,
): { before: Map<string, AgentTimelineEvent[]>; trailing: AgentTimelineEvent[] } {
  const before = new Map<string, AgentTimelineEvent[]>()
  const trailing: AgentTimelineEvent[] = []

  for (const event of events) {
    const at = Date.parse(event.at)
    const index = messages.findIndex((message) => (message.createdAt ?? Infinity) > at)

    if (index < 0) trailing.push(event)
    else if (index > 0 || !hasEarlier) {
      const id = messages[index].id

      before.set(id, [...(before.get(id) ?? []), event])
    }
  }

  return { before, trailing }
}
