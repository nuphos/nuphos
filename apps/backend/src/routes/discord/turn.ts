import { randomUUID } from 'node:crypto'

import { pausedTurnKind } from '@/lib/agent/round-continuation'
import { turnRunner } from '@/lib/agent/turn-runner'
import { sendDiscordMessage } from '@/lib/discord/api'
import { discordInstallations, discordChannelMappings, markDiscordEvent } from '@/lib/discord/store'
import { startDiscordTyping } from '@/lib/discord/typing'
import { logError } from '@/lib/observability'
import { SlackAgentRunSink } from '@/lib/slack/stream-sink'

import { postDiscordToolApproval } from './approval'
import { recordDiscordThreadMessage } from './thread-history'

import type { UIMessage } from 'ai'

export async function executeDiscordTurn(args: {
  eventId: string
  guildId: string
  threadChannelId: string
  parentChannelId: string
  installationGeneration: number
  teamId: string
  ownerUserId: string
  actorUserId: string
  sessionId: string
  nuphosToken: string
  messages: UIMessage[]
  firstMessage: string
}): Promise<void> {
  const isConnected = async () => {
    const installation = await discordInstallations().findOne({
      teamId: args.teamId,
      guildId: args.guildId,
      generation: args.installationGeneration,
      enabled: true,
    })

    return Boolean(
      installation &&
      (await discordChannelMappings().findOne({
        teamId: args.teamId,
        guildId: args.guildId,
        channelId: args.parentChannelId,
        enabled: true,
      })),
    )
  }

  if (!(await isConnected())) {
    await markDiscordEvent(args.eventId, 'ignored')

    return
  }
  const sink = new SlackAgentRunSink(
    async (text) => {
      if (!(await isConnected())) return
      await sendDiscordMessage(args.threadChannelId, text)
      await recordDiscordThreadMessage(args.sessionId, {
        id: randomUUID(),
        authorName: 'Nuphos',
        text,
        fromBot: true,
      })
    },
    undefined,
    (request) =>
      postDiscordToolApproval({
        request,
        guildId: args.guildId,
        channelId: args.threadChannelId,
        parentChannelId: args.parentChannelId,
        installationGeneration: args.installationGeneration,
        teamId: args.teamId,
        sessionId: args.sessionId,
        actorUserId: args.actorUserId,
      }),
  )

  const stopTyping = startDiscordTyping(args.threadChannelId)

  try {
    const outcome = await turnRunner.runAgentForTrigger({
      userId: args.actorUserId,
      conversationOwnerUserId: args.ownerUserId,
      nuphosToken: args.nuphosToken,
      teamId: args.teamId,
      sessionId: args.sessionId,
      messages: args.messages,
      firstMessage: args.firstMessage,
      source: 'discord.agent',
      frameSink: sink,
    })

    await sink.settle()
    if (sink.terminal() === 'paused') {
      await sink.say(
        pausedTurnKind(outcome.pauseReason) === 'budget-exhausted'
          ? 'This task needs another turn. Reply in this thread and I will continue.'
          : 'This turn stopped before finishing. Reply in this thread to resume.',
      )
    } else if (sink.terminal() === 'error') {
      await sink.say('Nuphos hit an error while handling this request.')
    }
    await markDiscordEvent(args.eventId, 'completed')
  } catch (err) {
    logError('discord.agent.turn.error', err, {
      event_id: args.eventId,
      session_id: args.sessionId,
      discord_thread_id: args.threadChannelId,
    })
    await markDiscordEvent(args.eventId, 'failed', err instanceof Error ? err.message : String(err))
    await sink.say('Nuphos hit an error while handling this request.').catch(() => {})
  } finally {
    stopTyping()
  }
}
