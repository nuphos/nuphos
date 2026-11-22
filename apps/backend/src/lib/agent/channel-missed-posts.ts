// A post an agent never got while it was away reaches it once it is back.
import { logError } from '@/lib/observability'

import { notifyAgent } from './channel-chat'
import { readChannelMessages } from './db/channels'
import { agentConversations } from './db/shared'
import { onDevice } from './deliver-waiting-answers'

import type { TeamRuntimeEndpoint } from '@/lib/claude-code-preview/team-openab-runtime'

/**
 * A runtime answered again, for any conversation's reason: its agents are woken for
 * the posts they missed while it was away (#3284).
 */
export function wakeOnRuntime(teamId: string, endpoint: TeamRuntimeEndpoint): void {
  const filter = endpoint.local
    ? onDevice(endpoint.local.userId, endpoint.local.deviceId)
    : endpoint.runtimeId && { teamId, runtimeId: endpoint.runtimeId }

  if (filter) void wakeMissedPosts(filter)
}

/**
 * The agents `filter` picks can run again (their computer is back): each one a
 * person's post in a channel never reached is woken for it, as the post would
 * have. Its place in the channel already records what it missed. Never throws.
 */
export async function wakeMissedPosts(filter: Record<string, unknown>): Promise<void> {
  try {
    const agents = await agentConversations()
      .find({ ...filter, archivedAt: { $exists: false } }, { projection: { sessionId: 1 } })
      .limit(500)
      .toArray()

    const channels = await agentConversations()
      .find({
        kind: 'channel',
        agentSessionIds: { $in: agents.map(({ sessionId }) => sessionId) },
        archivedAt: { $exists: false },
      })
      .toArray()

    for (const { sessionId } of agents) {
      for (const channel of channels) {
        if (!channel.agentSessionIds?.includes(sessionId)) continue
        // Never woken here yet, so nothing it was sent went missing.
        if (!channel.teamId || channel.agentReadIndex?.[sessionId] === undefined) continue
        const { messages } = await readChannelMessages(channel, sessionId, channel.userId, true)

        // Agents' posts past the turn budget wait for a person, as they do online.
        if (messages.some((message) => message.sender?.type === 'user'))
          await notifyAgent({ ...channel, teamId: channel.teamId }, sessionId, false)
      }
    }
  } catch (error) {
    logError('agent.channel.missed_wake_failed', error)
  }
}
