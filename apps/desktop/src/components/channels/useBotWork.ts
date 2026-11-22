import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { queryKeys } from '../../lib/query/keys'
import { runtimeTurnActive } from '../../lib/runtimeExecution'
import { useAgentSessions } from '../sidebar/agentSessions'

import { botWorkOf, workSince } from './botWork'

import type { BotWork } from './botWork'
import type { Run } from '../sidebar/bot-activity'

/**
 * What the Bot of this chat is doing, read as its sidebar row reads it: the
 * Bot's session and its sub-agents from the listed chats, with their live
 * runtime states. `since` is when it took up this work, if a run says.
 */
export function useBotWork(
  teamId: string,
  botId: string | undefined,
  channelId: string,
): { work: BotWork | null; since: number | undefined } {
  const sessions = useAgentSessions(teamId).data
  const states = useAgentRuntimeStates()
  const run = (conversation: Run['conversation']): Run => ({
    conversation,
    runtimeState: states.get(conversation.sessionId),
  })
  const conversation = botId ? sessions?.find((row) => row.sessionId === botId) : undefined
  const bot = conversation && run(conversation)
  const kids = botId ? (sessions ?? []).filter((row) => row.parentSessionId === botId).map(run) : []
  const work = botWorkOf(bot, kids, channelId)

  useRelistWhenTurnEnds(
    teamId,
    botId,
    runtimeTurnActive(bot?.runtimeState) ? conversation?.activeRun?.streamId : undefined,
  )

  return { work, since: workSince(work, bot) }
}

/** The list polls every 4 s; while the Bot's turn runs, its end lists again at once, so the
 *  header and its row stop with the Bot. */
function useRelistWhenTurnEnds(teamId: string, botId: string | undefined, streamId?: string) {
  const client = useQueryClient()

  useEffect(() => {
    if (!botId || !streamId) return
    let open = true

    void window.api.agentWaitForRunEnd({ sessionId: botId, teamId, streamId }).then(() => {
      if (open) void client.invalidateQueries({ queryKey: queryKeys.agentSessions(teamId) })
    })

    return () => {
      open = false
      void window.api.agentStopWaitingForRunEnd(streamId)
    }
  }, [client, teamId, botId, streamId])
}

/** The time now, once a second while `on`. */
export function useTicking(on: boolean): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!on) return
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 1000)

    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [on])

  return now
}
