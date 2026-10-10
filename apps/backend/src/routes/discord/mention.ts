import { buildPendingUserMessage } from '@/lib/agent/pending-messages'
import { logError, logEvent } from '@/lib/observability'

import { defaultDependencies } from './message-dependencies'
import { quoteDiscordReply } from './message'

import type { DiscordMessageCreate } from './message'

import type { DiscordMessageDependencies } from './message-dependencies'

export type { DiscordMessageCreate } from './message'
export type { DiscordMessageDependencies } from './message-dependencies'

function stripBotMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim()
}

export function isDirectDiscordMention(event: DiscordMessageCreate, botUserId: string): boolean {
  return event.mentions?.some((mention) => mention.id === botUserId) ?? false
}

export async function handleDiscordMention(
  event: DiscordMessageCreate,
  botUserId: string,
  alreadyClaimed = false,
  dependencies: DiscordMessageDependencies = defaultDependencies,
): Promise<void> {
  const {
    recordDiscordSessionMessage,
    discordDecisions,
    claimDiscordEvent,
    discordAgentThreads,
    discordChannelMappings,
    discordInstallations,
    discordUserMappings,
    getOrCreateDiscordThread,
    markDiscordEvent,
    refreshDiscordEventClaim,
    getTeamMembership,
    signNuphosToken,
    createDiscordThread,
    getDiscordChannel,
    sendDiscordMessage,
    getDiscordThreadHistory,
    recordDiscordThreadMessage,
    judgeThreadAddressing,
    buildMessagesForDiscordTurn,
    createMessageMetadata,
    executeDiscordTurn,
    turnRunner,
  } = dependencies

  if (!event.guild_id || !event.author || event.author.id === botUserId) return
  const canTrigger = !event.author.bot && !event.webhook_id
  const mentioned = canTrigger && isDirectDiscordMention(event, botUserId)
  const registeredThread = await discordAgentThreads().findOne({
    guildId: event.guild_id,
    threadChannelId: event.channel_id,
  })

  if (!mentioned && !registeredThread) return
  if (!alreadyClaimed && !(await claimDiscordEvent(event.id, event))) return
  const refreshTimer = setInterval(() => {
    void refreshDiscordEventClaim(event.id).catch(() => {})
  }, 60_000)

  try {
    const installation = await discordInstallations().findOne({
      guildId: event.guild_id,
      enabled: true,
    })

    if (!installation) {
      await markDiscordEvent(event.id, 'completed')

      return
    }
    const channel = await getDiscordChannel(event.channel_id)
    const isThread = channel.type === 10 || channel.type === 11 || channel.type === 12
    const parentChannelId = isThread ? channel.parent_id : event.channel_id

    if (!parentChannelId) throw new Error('Discord thread has no parent channel')
    const channelMapping = await discordChannelMappings().findOne({
      guildId: event.guild_id,
      channelId: parentChannelId,
      teamId: installation.teamId,
      enabled: true,
    })

    if (!channelMapping) {
      await markDiscordEvent(event.id, 'completed')

      return
    }
    const senderName =
      event.member?.nick ?? event.author.global_name ?? event.author.username ?? 'A teammate'

    if (
      registeredThread &&
      registeredThread.teamId === installation.teamId &&
      registeredThread.generation === installation.generation &&
      event.content?.trim()
    ) {
      await recordDiscordSessionMessage(registeredThread, event, senderName)
    }
    if (!canTrigger) {
      await markDiscordEvent(event.id, 'ignored')

      return
    }
    const userMapping = await discordUserMappings().findOne({
      guildId: event.guild_id,
      discordUserId: event.author.id,
      teamId: installation.teamId,
      enabled: true,
    })

    const membership = userMapping
      ? await getTeamMembership(userMapping.nuphosUserId, installation.teamId)
      : null

    if (!userMapping || !membership) {
      if (mentioned)
        await sendDiscordMessage(
          event.channel_id,
          'Link your Discord account from Nuphos Settings → Discord before asking me to act.',
        ).catch(() => {})
      await markDiscordEvent(event.id, 'completed')

      return
    }
    let text = stripBotMention(event.content ?? '', botUserId)

    if (!text && mentioned && registeredThread)
      text = 'Please join the conversation using the thread context.'

    if (!text) {
      if (mentioned)
        await sendDiscordMessage(event.channel_id, 'What would you like Nuphos to look into?')
      await markDiscordEvent(event.id, 'completed')

      return
    }
    const threadChannelId = registeredThread
      ? registeredThread.threadChannelId
      : isThread
        ? event.channel_id
        : (
            await createDiscordThread({
              channelId: event.channel_id,
              messageId: event.id,
              name: text.replace(/\s+/g, ' ').slice(0, 80) || 'Nuphos conversation',
            })
          ).id
    const thread = await getOrCreateDiscordThread({
      guildId: event.guild_id,
      parentChannelId,
      threadChannelId,
      rootMessageId: event.id,
      teamId: installation.teamId,
      agentUserId: registeredThread?.agentUserId ?? userMapping.nuphosUserId,
      createdByDiscordUserId: registeredThread?.createdByDiscordUserId ?? event.author.id,
      generation: installation.generation,
    })

    if (thread.teamId !== installation.teamId || thread.generation !== installation.generation) {
      await sendDiscordMessage(
        threadChannelId,
        'This conversation belongs to an older installation. Start a new mention.',
      )
      await markDiscordEvent(event.id, 'completed')

      return
    }
    if (!registeredThread) await recordDiscordSessionMessage(thread, event, senderName)
    const history = (await getDiscordThreadHistory(thread.sessionId)).filter(
      (entry) => entry.id !== event.id,
    )

    let ignoredByAgent = false

    if (!mentioned) {
      const pendingDecision = Boolean(
        await discordDecisions().findOne({
          sessionId: thread.sessionId,
          status: 'pending',
          expiresAt: { $gt: new Date() },
        }),
      )
      const judgement = await judgeThreadAddressing({
        botName: 'Nuphos',
        participation: 'collaborative',
        history,
        pendingDecision,
        incoming: { authorName: senderName, text },
        context: { userId: thread.agentUserId, sessionId: thread.sessionId, teamId: thread.teamId },
      })

      logEvent('info', 'discord.agent.thread_addressing', {
        team_id: thread.teamId,
        session_id: thread.sessionId,
        discord_thread_id: thread.threadChannelId,
        addressed: judgement.verdict?.addressed ?? true,
        fail_open: judgement.verdict === null,
        reason: judgement.verdict?.reason,
      })
      ignoredByAgent = judgement.verdict?.addressed === false
    }
    await recordDiscordThreadMessage(thread.sessionId, {
      id: event.id,
      authorName: senderName,
      authorDiscordUserId: event.author.id,
      recordedAt: new Date(),
      text,
    })
    if (ignoredByAgent) {
      await markDiscordEvent(event.id, 'ignored')

      return
    }
    const renderedText = event.referenced_message
      ? quoteDiscordReply(event.referenced_message, text)
      : text
    const metadata = await createMessageMetadata(userMapping.nuphosUserId, 'discord')
    const claim = await turnRunner.claimAgentRunOrEnqueue({
      userId: thread.agentUserId,
      sessionId: thread.sessionId,
      actorUserId: userMapping.nuphosUserId,
      message: {
        ...buildPendingUserMessage({
          renderedText,
          source: 'discord',
          metadata,
          actorUserId: userMapping.nuphosUserId,
        }),
        // The Discord id is how the transcript knows this message has arrived.
        id: `discord-${event.id}`,
      },
    })

    if (claim.mode === 'dropped') {
      await sendDiscordMessage(
        threadChannelId,
        "I'm still handling the previous message. Mention me again in a moment.",
      )
      await markDiscordEvent(event.id, 'completed')

      return
    }
    if (claim.mode === 'queued') {
      await markDiscordEvent(event.id, 'completed')

      return
    }

    try {
      const { messages, turnContext } = await buildMessagesForDiscordTurn({
        scope: {
          sessionId: thread.sessionId,
          teamId: thread.teamId,
          guildId: thread.guildId,
          generation: thread.generation,
        },
        ownerUserId: thread.agentUserId,
        messageId: event.id,
        renderedText,
        metadata,
        carried: claim.carried,
      })

      await executeDiscordTurn({
        eventId: event.id,
        guildId: event.guild_id,
        threadChannelId,
        parentChannelId: thread.parentChannelId,
        installationGeneration: thread.generation,
        teamId: thread.teamId,
        ownerUserId: thread.agentUserId,
        actorUserId: userMapping.nuphosUserId,
        sessionId: thread.sessionId,
        nuphosToken: signNuphosToken(userMapping.nuphosUserId, 60 * 60 * 8),
        messages,
        firstMessage: text,
        turnContext,
      })
    } finally {
      claim.release()
    }
  } catch (err) {
    logError('discord.agent.message.error', err, {
      event_id: event.id,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
    })
    await markDiscordEvent(event.id, 'failed', err instanceof Error ? err.message : String(err))
  } finally {
    clearInterval(refreshTimer)
  }
}
