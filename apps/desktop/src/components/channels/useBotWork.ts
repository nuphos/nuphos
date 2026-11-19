import { useEffect, useState } from 'react'

import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { runtimeTurnActive } from '../../lib/runtimeExecution'
import { useAgentSessions } from '../sidebar/agentSessions'

import { botWorkOf, runStartedAt, workSince } from './botWork'

import type { BotWork } from './botWork'
import type { Run } from '../sidebar/bot-activity'

const BOT_TURN_POLL_MS = 1_000
// A turn the runtime never closes must not keep the fast poll up for as long as the chat is open.
const BOT_TURN_FAST_FOR_MS = 120_000

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

  // Only the list says a turn ended: in a turn's first two minutes, read it every second, so
  // the header and its row stop soon after the Bot does. Asked again after every listing.
  const active = runtimeTurnActive(bot?.runtimeState)
  const started = runStartedAt(bot)

  useAgentSessions(teamId, () =>
    active && started !== undefined && Date.now() - started < BOT_TURN_FAST_FOR_MS
      ? BOT_TURN_POLL_MS
      : false,
  )

  return { work, since: workSince(work, bot) }
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
