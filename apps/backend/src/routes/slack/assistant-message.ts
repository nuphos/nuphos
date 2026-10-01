import { randomUUID } from 'node:crypto'

import type { SlackEventEnvelope, SlackRuntime } from '@/routes/slack/types'

import { getConversation } from '@/lib/agent/db'
import { appendMessageOriginLine, buildSlackMessageOrigin } from '@/lib/agent/message-origin'
import { signNuphosToken } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import {
  getOrCreateSlackAgentThread,
  getSlackAssistantThreadContext,
  markSlackEvent,
} from '@/lib/slack/agent-bot'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { getSlackThreadTurnIdentity } from '@/lib/slack/thread-access'
import { fetchSlackUserName } from '@/lib/slack/user-profile'
import { ingestSlackAttachments } from '@/routes/slack/attachments'
import { fetchSlackChannelName, resolveSlackUserMapping } from '@/routes/slack/identity'
import { appendAttachmentNote, buildMessagesForRenderedTurn } from '@/routes/slack/messages'
import { renderSlackUserMessage } from '@/routes/slack/render'
import {
  postThreadMessage,
  stripBotMention,
  SUBTYPES_WITH_ATTACHMENTS,
} from '@/routes/slack/shared'
import {
  ASSISTANT_LOADING_MESSAGES,
  ASSISTANT_THINKING_STATUS,
  deriveThreadTitle,
  setAssistantStatusSafe,
  setAssistantTitleSafe,
} from '@/routes/slack/status'
import { checkNotificationReplyAccess } from '@/routes/slack/thread-gates'
import { executeSlackAgentTurn } from '@/routes/slack/turn'
import { claimSlackTurnOrQueue } from '@/routes/slack/turn-admission'

// A user message in the assistant DM pane (message event, channel_type 'im').
// Mirrors the channel flow but resolves the team from the workspace binding
// (DMs have no channel mapping), shows the native "is thinking…" status, and
// paces the reply as plain thread messages via SlackAgentRunSink.
export async function handleAssistantMessage(envelope: SlackEventEnvelope): Promise<void> {
  const event = envelope.event
  const eventId = envelope.event_id
  const slackWorkspaceId = envelope.team_id

  if (!event || !eventId || !slackWorkspaceId) return
  if (event.type !== 'message') {
    await markSlackEvent(eventId, 'ignored')

    return
  }

  const botContext = await resolveSlackBotForWorkspace(slackWorkspaceId)

  if (!botContext) {
    await markSlackEvent(eventId, 'failed', 'No Slack bot configured for this workspace')

    return
  }
  const runtime: SlackRuntime = {
    botToken: botContext.botToken,
    botUserId: botContext.botUserId,
  }

  // Never reply to our own messages or system/bot subtypes.
  if (
    event.bot_id ||
    (event.subtype && !SUBTYPES_WITH_ATTACHMENTS.has(event.subtype)) ||
    (runtime.botUserId && event.user === runtime.botUserId) ||
    !event.channel ||
    !event.ts ||
    !event.user
  ) {
    await markSlackEvent(eventId, 'ignored')

    return
  }

  const nuphosTeamId = botContext.nuphosTeamId
  const threadTs = event.thread_ts ?? event.ts

  if (!nuphosTeamId) {
    await postThreadMessage(
      runtime,
      event.channel,
      threadTs,
      'Nuphos is not fully installed for this Slack workspace yet.',
    )
    await markSlackEvent(eventId, 'completed')

    return
  }

  const text = stripBotMention(event.text ?? '', runtime.botUserId)

  if (!text && (event.files ?? []).length === 0) {
    await markSlackEvent(eventId, 'ignored')

    return
  }

  const { mapping: userMapping, email } = await resolveSlackUserMapping(
    slackWorkspaceId,
    nuphosTeamId,
    event.user,
    runtime.botToken,
  )

  if (!userMapping) {
    await postThreadMessage(
      runtime,
      event.channel,
      threadTs,
      email
        ? "Your Slack email doesn't match any Nuphos user on this team. Link your account in Nuphos → Settings → Slack."
        : 'Your Slack account is not linked to Nuphos yet. Link it in Nuphos → Settings → Slack.',
    )
    await markSlackEvent(eventId, 'completed')

    return
  }

  const { thread, isNew } = await getOrCreateSlackAgentThread({
    slackWorkspaceId,
    slackChannelId: event.channel,
    slackThreadTs: threadTs,
    teamId: nuphosTeamId,
    agentUserId: userMapping.nuphosUserId,
    createdBySlackUserId: event.user,
    lastSlackEventId: eventId,
  })

  if (
    thread.origin === 'agent_notification' &&
    !(await checkNotificationReplyAccess({
      runtime,
      thread,
      senderNuphosUserId: userMapping.nuphosUserId,
      channelId: event.channel,
      threadTs,
      eventId,
    }))
  ) {
    return
  }
  const turnIdentity = getSlackThreadTurnIdentity(thread, userMapping.nuphosUserId)

  // Name new threads after the user's opening message so the Messages-tab
  // timeline stays navigable.
  if (isNew) {
    await setAssistantTitleSafe(
      runtime.botToken,
      event.channel,
      threadTs,
      deriveThreadTitle(text || 'Shared a file'),
    )
  }
  // What the user was viewing when they wrote this: message.im payloads carry no
  // context of their own, so read what the assistant_thread_* events persisted.
  const contextChannelId = await getSlackAssistantThreadContext(
    slackWorkspaceId,
    event.channel,
    threadTs,
  )
  const [senderName, contextChannelName] = await Promise.all([
    fetchSlackUserName(runtime.botToken, slackWorkspaceId, event.user),
    contextChannelId
      ? fetchSlackChannelName(runtime.botToken, slackWorkspaceId, contextChannelId)
      : Promise.resolve(undefined),
  ])
  const dmAttachments = await ingestSlackAttachments({
    runtime,
    event,
    teamId: thread.teamId,
    userId: thread.agentUserId,
    sessionId: thread.sessionId,
  })
  const messageOrigin = buildSlackMessageOrigin({
    workspaceId: slackWorkspaceId,
    channelId: event.channel,
    threadTs,
    messageTs: event.ts,
    userId: event.user,
    userName: senderName,
  })
  const renderedText = appendMessageOriginLine(
    appendAttachmentNote(
      renderSlackUserMessage(event, text || '(shared a file)', {
        dm: true,
        senderName,
        contextChannelId,
        contextChannelName,
      }),
      dmAttachments.note,
    ),
    messageOrigin,
  )
  const claim = await claimSlackTurnOrQueue({
    runtime,
    userId: thread.agentUserId,
    sessionId: thread.sessionId,
    channel: event.channel,
    threadTs,
    eventId,
    renderedText,
    actorUserId: turnIdentity.actorUserId,
    reactionMessageTs: event.ts,
  })

  if (!claim) return
  const releaseAgentRunClaim = claim.release

  // Captured for the afterFinish closure: TS narrowing on event.channel does
  // not survive into callbacks.
  const dmChannel = event.channel

  await setAssistantStatusSafe(
    runtime.botToken,
    dmChannel,
    threadTs,
    ASSISTANT_THINKING_STATUS,
    ASSISTANT_LOADING_MESSAGES,
  )
  try {
    const messages = await buildMessagesForRenderedTurn({
      sessionId: thread.sessionId,
      userId: turnIdentity.conversationOwnerUserId,
      teamId: thread.teamId,
      messageId: `slack-${event.event_ts ?? event.ts ?? randomUUID()}`,
      renderedText,
      carried: claim.carried,
      actorUserId: userMapping.nuphosUserId,
      attachmentParts: dmAttachments.parts,
      origin: messageOrigin,
    })

    await executeSlackAgentTurn({
      runtime,
      eventId,
      sessionId: thread.sessionId,
      agentUserId: turnIdentity.conversationOwnerUserId,
      actorUserId: turnIdentity.actorUserId,
      teamId: thread.teamId,
      channel: event.channel,
      threadTs,
      nuphosToken: signNuphosToken(turnIdentity.actorUserId, 60 * 60 * 8),
      sender: { slackUserId: event.user, displayName: senderName },
      messages,
      firstMessage: text,
      reactionMessageTs: event.ts,
      contextChannelId,
      actionToken: event.action_token,
      // Clear the "is thinking…" indicator once the reply finalizes. It
      // auto-clears when a message lands, but a failed run must never leave a
      // stuck spinner in the assistant pane (setAssistantStatusSafe swallows
      // its own errors).
      afterFinish: async () => {
        await setAssistantStatusSafe(runtime.botToken, dmChannel, threadTs, '')
        // History-tab readability: once the turn has persisted an LLM-generated
        // conversation title, promote it over the first-message-derived one.
        // Best-effort — the generated title may not exist yet on early turns.
        try {
          const conversation = await getConversation(
            thread.sessionId,
            thread.agentUserId,
            thread.teamId,
          )
          const generatedTitle = conversation?.title?.trim()

          if (generatedTitle && generatedTitle !== text) {
            await setAssistantTitleSafe(
              runtime.botToken,
              dmChannel,
              threadTs,
              deriveThreadTitle(generatedTitle),
            )
          }
        } catch (err) {
          logEvent('warn', 'slack.assistant.title_sync_failed', {
            slack_channel_id: dmChannel,
            slack_thread_ts: threadTs,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    })
  } finally {
    releaseAgentRunClaim()
  }
}
