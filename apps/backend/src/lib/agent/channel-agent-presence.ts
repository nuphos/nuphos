// Each agent in a chat with its presence (#3308), so the chat can say why one is not
// answering and its member list can show who can reply, whoever's agent it is.
import { logError } from '@/lib/observability'

import { botPresence, botRuntimes } from './bot-presence'
import { agentConversations } from './db/shared'
import { isActiveTeamMember } from './devices/store'
import { getActiveAgentRunsForSessions } from './run-store'

import type { BotPresence } from './bot-presence'

type Listed = { sessionId: string; ownerId: string }

/** The agents as they are when their presence cannot be read: the chat still lists them. */
export async function withPresence<T extends Listed>(
  teamId: string | undefined,
  agents: T[],
): Promise<(T & { presence?: BotPresence })[]> {
  if (!teamId || agents.length === 0) return agents

  return presences(teamId, agents).catch((error: unknown) => {
    logError('agent.channel.presence_failed', error, { team_id: teamId })

    return agents
  })
}

async function presences<T extends Listed>(teamId: string, agents: T[]) {
  const owners = [...new Set(agents.map((agent) => agent.ownerId))]
  const [rows, runs, members] = await Promise.all([
    agentConversations()
      .find({ sessionId: { $in: agents.map((agent) => agent.sessionId) } })
      .project<{ sessionId: string; runtimeId?: string }>({ _id: 0, sessionId: 1, runtimeId: 1 })
      .toArray(),
    getActiveAgentRunsForSessions(
      agents.map((agent) => ({ userId: agent.ownerId, sessionId: agent.sessionId })),
    ),
    Promise.all(owners.map((owner) => isActiveTeamMember(owner, teamId))),
  ])
  const runtimeIdOf = new Map(rows.map((row) => [row.sessionId, row.runtimeId]))
  const removed = new Set(owners.filter((_, i) => !members[i]))
  const runtimes = await botRuntimes(
    teamId,
    agents.map((agent) => ({
      userId: agent.ownerId,
      runtimeId: runtimeIdOf.get(agent.sessionId),
    })),
  )

  return agents.map((agent, i) => ({
    ...agent,
    presence: botPresence({
      ownerRemoved: removed.has(agent.ownerId),
      runtime: runtimes[i] ?? null,
      busy: Boolean(runs[i]),
    }),
  }))
}
