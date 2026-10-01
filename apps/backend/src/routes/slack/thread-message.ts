import { randomUUID } from 'node:crypto'

import type { SlackEventEnvelope, SlackRuntime } from '@/routes/slack/types'

import { appendMessageOriginLine, buildSlackMessageOrigin } from '@/lib/agent/message-origin'
import { signNuphosToken } from '@/lib/identity'
import {
  appendSlackThreadMessage,
  getSlackAgentThread,
  markSlackEvent,
} from '@/lib/slack/agent-bot'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { getSlackThreadTurnIdentity } from '@/lib/slack/thread-access'
import { fetchSlackUserName } from '@/lib/slack/user-profile'
import { ingestSlackAttachments } from '@/routes/slack/attachments'
import { fetchSlackChannelName, resolveSlackUserMapping } from '@/routes/slack/identity'
import { appendAttachmentNote, buildMessagesForRenderedTurn } from '@/routes/slack/messages'
import {
  joinThreadContext,
  renderForkedThreadOrigin,
  renderMissedThreadMessages,
  renderSlackUserMessage,
  resolveSlackMentionNames,
} from '@/routes/slack/render'
import {
  explainUnboundNuphosThread,
  postThreadMessage,
  stripBotMention,
  SUBTYPES_WITH_ATTACHMENTS,
} from '@/routes/slack/shared'
import { beginThreadStatus } from '@/routes/slack/status'
import {
  checkNotificationReplyAccess,
  isReplyAddressedToAgent,
  verifyThreadTeamAccess,
} from '@/routes/slack/thread-gates'
import { executeSlackAgentTurn } from '@/routes/slack/turn'
import { claimSlackTurnOrQueue } from '@/routes/slack/turn-admission'

// Exported for tests (see handleAppMention).
export async function handleThreadMessage(envelope: SlackEventEnvelope): Promise<void> {
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

  if (
    event.bot_id ||
    (event.subtype && !SUBTYPES_WITH_ATTACHMENTS.has(event.subtype)) ||
    (runtime.botUserId && event.user === runtime.botUserId) ||
    !event.channel ||
    !event.thread_ts ||
    !event.ts ||
    !event.user ||
    event.ts === event.thread_ts
  ) {
    await markSlackEvent(eventId, 'ignored')

    return
  }
  const thread = await getSlackAgentThread(slackWorkspaceId, event.channel, event.thread_ts)

  // A reply that @-mentions the bot also fires app_mention (a separate event
  // id, so claimSlackEvent cannot dedupe it). The mention handler owns normal
  // Slack-originated threads. Proactive notification threads stay here: the
  // app_mention handler explicitly yields those to this generic message event.
  if (
    runtime.botUserId &&
    (event.text ?? '').includes(`<@${runtime.botUserId}>`) &&
    thread?.origin !== 'agent_notification'
  ) {
    await markSlackEvent(eventId, 'ignored')

    return
  }

  if (!thread) {
    // This handler sees every threaded reply in every channel the bot is in, so
    // silence is right for a thread between other people. Under a root the bot
    // itself posted it is not: someone is talking to Nuphos and getting nothing
    // back, which is exactly how an unbound proactive post reads today. Tell
    // them how to reach it instead of dropping the message.
    if (runtime.botUserId && event.parent_user_id === runtime.botUserId) {
      await explainUnboundNuphosThread(runtime, event.channel, event.thread_ts)
      await markSlackEvent(eventId, 'completed')

      return
    }
    await markSlackEvent(eventId, 'ignored')

    return
  }
  const allowed = await verifyThreadTeamAccess({
    runtime,
    botNuphosTeamId: botContext.nuphosTeamId,
    thread,
    slackWorkspaceId,
    channelId: event.channel,
    threadTs: event.thread_ts,
    eventId,
  })

  if (!allowed) return

  const text = stripBotMention(event.text ?? '', runtime.botUserId)

  if (!text && (event.files ?? []).length === 0) {
    await markSlackEvent(eventId, 'ignored')

    return
  }

  const threadKey = {
    slackWorkspaceId,
    slackChannelId: event.channel,
    slackThreadTs: event.thread_ts,
  }
  const senderName = await fetchSlackUserName(runtime.botToken, slackWorkspaceId, event.user)
  const resolvedText = await resolveSlackMentionNames(runtime.botToken, slackWorkspaceId, text)

  await appendSlackThreadMessage(threadKey, {
    ts: event.ts,
    authorName: senderName ?? `<@${event.user}>`,
    text: resolvedText,
  }).catch(() => {})

  // Mentions never reach here for Slack-origin threads (they route to
  // handleAppMention); in notification threads they stay, and an explicit
  // mention is an answer on its own.
  const mentionsBot =
    Boolean(runtime.botUserId) && (event.text ?? '').includes(`<@${runtime.botUserId}>`)
  const history = (thread.recentMessages ?? []).filter((record) => record.ts !== event.ts)

  if (
    !mentionsBot &&
    !(await isReplyAddressedToAgent({
      thread,
      history,
      senderName,
      resolvedText,
      slackWorkspaceId,
      channelId: event.channel,
      threadTs: event.thread_ts,
      eventId,
    }))
  ) {
    await markSlackEvent(eventId, 'ignored')

    return
  }
  const { mapping: senderMapping, email } = await resolveSlackUserMapping(
    slackWorkspaceId,
    thread.teamId,
    event.user,
    runtime.botToken,
  )

  // Fail closed before resolving a turn actor: an unlinked Slack user must not
  // be able to drive a team conversation just by replying in its thread.
  // Mirrors the mention handler.
  if (!senderMapping) {
    await postThreadMessage(
      runtime,
      event.channel,
      event.thread_ts,
      email
        ? "Your Slack email doesn't match any Nuphos user on this team, so I can't act on your reply. Link your account in Nuphos → Settings → Slack first."
        : "Your Slack account is not linked to Nuphos yet, so I can't act on your reply. Link it in Nuphos → Settings → Slack first.",
    )
    await markSlackEvent(eventId, 'completed')

    return
  }
  if (
    thread.origin === 'agent_notification' &&
    !(await checkNotificationReplyAccess({
      runtime,
      thread,
      senderNuphosUserId: senderMapping.nuphosUserId,
      channelId: event.channel,
      threadTs: event.thread_ts,
      eventId,
    }))
  ) {
    return
  }
  const turnNuphosToken = signNuphosToken(senderMapping.nuphosUserId, 60 * 60 * 8)
  const channelName = await fetchSlackChannelName(runtime.botToken, slackWorkspaceId, event.channel)
  const threadAttachments = await ingestSlackAttachments({
    runtime,
    event,
    teamId: thread.teamId,
    userId: thread.agentUserId,
    sessionId: thread.sessionId,
  })
  const messageOrigin = buildSlackMessageOrigin({
    workspaceId: slackWorkspaceId,
    channelId: event.channel,
    channelName,
    threadTs: event.thread_ts,
    messageTs: event.ts,
    userId: event.user,
    userName: senderName,
  })
  const renderedText = appendMessageOriginLine(
    appendAttachmentNote(
      renderSlackUserMessage(event, resolvedText || '(shared a file)', {
        senderName,
        channelName,
        threadContext: joinThreadContext(
          renderForkedThreadOrigin(thread),
          renderMissedThreadMessages(history),
        ),
      }),
      threadAttachments.note,
    ),
    messageOrigin,
  )
  const claim = await claimSlackTurnOrQueue({
    runtime,
    userId: thread.agentUserId,
    sessionId: thread.sessionId,
    channel: event.channel,
    threadTs: event.thread_ts,
    eventId,
    renderedText,
    actorUserId: senderMapping.nuphosUserId,
    reactionMessageTs: event.ts,
  })

  if (!claim) return
  const releaseAgentRunClaim = claim.release

  // Only the event that actually owns a new turn may replace the shared
  // thread status. A queued or cross-principal message must not clobber the
  // live actor's tool/status line.
  beginThreadStatus(runtime, event.channel, event.thread_ts)

  try {
    const turnIdentity = getSlackThreadTurnIdentity(thread, senderMapping.nuphosUserId)
    const messages = await buildMessagesForRenderedTurn({
      sessionId: thread.sessionId,
      userId: turnIdentity.conversationOwnerUserId,
      teamId: thread.teamId,
      messageId: `slack-${event.event_ts ?? event.ts ?? randomUUID()}`,
      renderedText,
      carried: claim.carried,
      actorUserId: senderMapping.nuphosUserId,
      attachmentParts: threadAttachments.parts,
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
      threadTs: event.thread_ts,
      nuphosToken: turnNuphosToken,
      sender: { slackUserId: event.user, displayName: senderName },
      messages,
      firstMessage: resolvedText,
      reactionMessageTs: event.ts,
      // In a channel conversation the channel itself is the search context.
      contextChannelId: event.channel,
      actionToken: event.action_token,
      transcriptThreadKey: threadKey,
    })
  } finally {
    releaseAgentRunClaim()
  }
}
