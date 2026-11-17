import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { noteReplyFailed } from './channel-wake'
import { startConversationTurn } from './conversation-turn'
import { getConversationBySessionId } from './db'
import { agentConversations } from './db/shared'

/** A person opens the newly created Bot's own chat, once. Never wakes an existing Bot. */
export async function startBotOnboarding(
  userId: string,
  teamId: string,
  botId: string,
  channelId: string,
) {
  const [bot, channel] = await Promise.all([
    getConversationBySessionId(botId),
    getConversationBySessionId(channelId),
  ])

  if (
    !bot ||
    bot.userId !== userId ||
    bot.teamId !== teamId ||
    !bot.avatar ||
    bot.kind === 'channel' ||
    bot.archivedAt ||
    !channel ||
    channel.userId !== userId ||
    channel.teamId !== teamId ||
    channel.kind !== 'channel' ||
    channel.archivedAt ||
    channel.agentSessionIds?.length !== 1 ||
    channel.agentSessionIds[0] !== botId ||
    (channel.generalAccess && channel.generalAccess !== 'none') ||
    channel.participantIds?.some((id) => id !== userId)
  ) {
    throw new AppError(404, 'not_found', 'New Bot chat not found')
  }
  const claimed = await agentConversations().updateOne(
    { sessionId: botId, userId, teamId, botOnboarding: 'pending', archivedAt: { $exists: false } },
    { $set: { botOnboarding: 'started' } },
  )

  if (!claimed.modifiedCount) return { started: false }
  try {
    const { run } = await startConversationTurn(
      {
        userId,
        teamId,
        targetSessionId: botId,
        messageId: `bot-onboarding:${botId}`,
        locale: bot.metadata?.locale ?? 'en',
      },
      bot,
      `The person just created you and opened your private Bot chat (channelId ${channelId}). ` +
        'Start the conversation there using channel_post, in the person’s language. Read your standing instructions. ' +
        'Briefly introduce what you can help with, then ask one focused question to learn their goal. ' +
        'If your instructions establish coordination work, post only a short introduction to the chat, then call request_user_decision with category preference and one focused question about the work they want you to coordinate. ' +
        'Generate 2–4 concise, relevant choices in the options field; the card also accepts a free-text answer. Do not just say you can coordinate and stop, and do not replace the interactive card with a prose list. ' +
        'Wait for the answer and end this turn after creating the card. Follow-up turns should acknowledge the answer in the original chat, save confirmed responsibilities through update_self, and ask the next necessary scope question through the same card mechanism. ' +
        'Do not ask them to write a prompt or repeat setup. Do not start executing unrelated work. ' +
        'Save responsibilities and preferences with update_self as the conversation establishes them. This is a one-time introduction.',
      'agent.resource',
      {
        version: 1,
        sender: { type: 'system', id: 'nuphos:bot-onboarding', displayName: 'Nuphos' },
        source: 'agent.resource',
        resourceUrl: `/teams/${teamId}/agent/${channelId}`,
        sentAt: new Date().toISOString(),
      },
    )

    void run.catch(async (error: unknown) => {
      logError('agent.bot_onboarding.turn_failed', error)
      await noteReplyFailed(channelId, botId, error).catch((noticeError: unknown) => {
        logError('agent.bot_onboarding.notice_failed', noticeError)
      })
    })

    return { started: true }
  } catch (error) {
    // A rejected hand-off can be retried without creating another Bot or intro.
    await agentConversations().updateOne(
      { sessionId: botId, userId, teamId, botOnboarding: 'started' },
      { $set: { botOnboarding: 'pending' } },
    )
    throw error
  }
}
