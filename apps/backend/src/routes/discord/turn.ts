import { randomUUID } from 'node:crypto'

import { pausedTurnKind } from '@/lib/agent/round-continuation'
import { turnRunner } from '@/lib/agent/turn-runner'
import { sendDiscordMessage } from '@/lib/discord/api'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import {
  discordAgentThreads,
  discordInstallations,
  discordChannelMappings,
  markDiscordEvent,
} from '@/lib/discord/store'
import { startDiscordTyping } from '@/lib/discord/typing'
import { logError } from '@/lib/observability'
import { SlackAgentRunSink } from '@/lib/slack/stream-sink'

import { postDiscordToolApproval } from './approval'
import { recordDiscordThreadMessage } from './thread-history'

import type { UIMessage } from 'ai'

type DiscordThreadRef = {
  teamId: string
  guildId: string
  generation: number
  parentChannelId: string
}

async function isDiscordThreadConnected(thread: DiscordThreadRef): Promise<boolean> {
  const installation = await discordInstallations().findOne({
    teamId: thread.teamId,
    guildId: thread.guildId,
    generation: thread.generation,
    enabled: true,
  })

  return Boolean(
    installation &&
    (await discordChannelMappings().findOne({
      teamId: thread.teamId,
      guildId: thread.guildId,
      channelId: thread.parentChannelId,
      enabled: true,
    })),
  )
}

/**
 * A turn started from the Nuphos app in a session bound to a Discord thread:
 * the question and the reply are posted to the thread too, so the thread
 * mirrors the session. Returns the sink to attach to the run, or null when the
 * session has no connected thread.
 */
export async function mirrorAppTurnToDiscord(args: {
  sessionId: string
  teamId: string
  /** The message that started the turn; absent when a turn is only resumed. */
  message?: UIMessage
}): Promise<SlackAgentRunSink | null> {
  const thread = await discordAgentThreads().findOne({
    sessionId: args.sessionId,
    teamId: args.teamId,
  })

  if (!thread || !(await isDiscordThreadConnected(thread))) return null
  const post = async (authorName: string, text: string, fromBot: boolean) => {
    if (!(await isDiscordThreadConnected(thread))) return
    await sendDiscordMessage(
      thread.threadChannelId,
      fromBot ? text : `**${authorName}** (from Nuphos):\n${text}`,
    )
    await recordDiscordThreadMessage(args.sessionId, {
      id: randomUUID(),
      authorName,
      text,
      ...(fromBot ? { fromBot } : {}),
    })
  }
  const text = args.message?.parts
    .flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
    .join('\n\n')

  if (text) {
    const sender = parseMessageMetadata(args.message?.metadata)?.sender.displayName

    await post(sender ?? 'Someone', text, false)
  }

  return new SlackAgentRunSink((reply) => post('Nuphos', reply, true))
}

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
  turnContext?: string
}): Promise<void> {
  const isConnected = () =>
    isDiscordThreadConnected({ ...args, generation: args.installationGeneration })

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
      ...(args.turnContext ? { turnContext: args.turnContext } : {}),
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
