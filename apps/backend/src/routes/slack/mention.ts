import { randomUUID } from 'node:crypto'

import type { SlackEventEnvelope, SlackRuntime } from '@/routes/slack/types'

import { appendMessageOriginLine, buildSlackMessageOrigin } from '@/lib/agent/message-origin'
import { signNuphosToken } from '@/lib/identity'
import {
  appendSlackThreadMessage,
  getOrCreateSlackAgentThread,
  getSlackAgentThread,
  getSlackChannelMapping,
  markSlackEvent,
} from '@/lib/slack/agent-bot'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { getSlackThreadTurnIdentity } from '@/lib/slack/thread-access'
import { fetchSlackUserName } from '@/lib/slack/user-profile'
import { ingestSlackAttachments } from '@/routes/slack/attachments'
import { fetchSlackChannelName, resolveSlackUserMapping } from '@/routes/slack/identity'
import { appendAttachmentNote, buildMessagesForRenderedTurn } from '@/routes/slack/messages'
import {
  fetchThreadContextSafe,
  renderSlackUserMessage,
  resolveSlackMentionNames,
} from '@/routes/slack/render'
import {
  postThreadMessage,
  stripBotMention,
  SUBTYPES_WITH_ATTACHMENTS,
} from '@/routes/slack/shared'
import { beginThreadStatus } from '@/routes/slack/status'
import { executeSlackAgentTurn } from '@/routes/slack/turn'
import { claimSlackTurnOrQueue } from '@/routes/slack/turn-admission'
import { handleUnmappedChannelMention } from '@/routes/slack/unlinked-channel'

// Exported for tests: every user-visible outcome of a mention (hint, onboarding
// prompt, turn, error) is asserted against this seam — mentions must never end
// in a silent ignore.
export async function handleAppMention(envelope: SlackEventEnvelope): Promise<void> {
  const event = envelope.event
  const eventId = envelope.event_id
  const slackWorkspaceId = envelope.team_id

  if (!event || !eventId || !slackWorkspaceId) return
  if (event.type !== 'app_mention') {
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
    (runtime.botUserId && event.user === runtime.botUserId)
  ) {
    await markSlackEvent(eventId, 'ignored')

    return
  }
  if (!event.channel || !event.ts || !event.user) {
    await markSlackEvent(eventId, 'failed', 'Missing required Slack app_mention fields')

    return
  }

  // A mention may sit at a thread root (starting a new agent thread) or inside
  // an existing discussion (pulling the agent into it — Slack's "app threads"
  // entry). Either way the mention owns the turn; handleThreadMessage yields
  // mention-bearing replies to this handler.
  const slackThreadTs = event.thread_ts ?? event.ts

  // A proactive notification thread is owned by the generic message handler,
  // even when the reply mentions the bot. Slack emits both message and
  // app_mention events for that reply; yielding here prevents a duplicate turn
  // and avoids re-running the channel-link onboarding path.
  if (event.thread_ts) {
    const proactiveThread = await getSlackAgentThread(
      slackWorkspaceId,
      event.channel,
      event.thread_ts,
    )

    if (proactiveThread?.origin === 'agent_notification') {
      await markSlackEvent(eventId, 'ignored')

      return
    }
  }
  const text = stripBotMention(event.text ?? '', runtime.botUserId)

  const mapping = await getSlackChannelMapping(slackWorkspaceId, event.channel)

  if (!mapping) {
    await handleUnmappedChannelMention({
      runtime,
      slackWorkspaceId,
      channelId: event.channel,
      slackThreadTs,
      eventId,
    })

    return
  }
  const { mapping: userMapping, email } = await resolveSlackUserMapping(
    slackWorkspaceId,
    mapping.teamId,
    event.user,
    runtime.botToken,
  )

  if (!userMapping) {
    await postThreadMessage(
      runtime,
      event.channel,
      slackThreadTs,
      email
        ? "Your Slack email doesn't match any Nuphos user on this team. Open your DM with me or go to Nuphos → Settings → Slack to link your account."
        : 'Your Slack account is not linked to Nuphos yet. Open your DM with me or link your account in Nuphos → Settings → Slack.',
    )
    await markSlackEvent(eventId, 'completed')

    return
  }

  const { thread, isNew } = await getOrCreateSlackAgentThread({
    slackWorkspaceId,
    slackChannelId: event.channel,
    slackThreadTs,
    teamId: mapping.teamId,
    agentUserId: userMapping.nuphosUserId,
    createdBySlackUserId: event.user,
    lastSlackEventId: eventId,
  })
  const hasAttachments = (event.files ?? []).length > 0

  if (!text && !hasAttachments) {
    // A bare mention has no turn to run, but the thread row above is already
    // registered, so a plain reply in this thread reaches the agent — without
    // it the hint would start a dead-end thread whose replies are dropped.
    await postThreadMessage(
      runtime,
      event.channel,
      slackThreadTs,
      'What would you like Nuphos to look into? Just reply in this thread.',
    )
    await markSlackEvent(eventId, 'completed')

    return
  }
  // First time the agent is mentioned into a discussion that already has
  // replies: brief it on what was said before the mention. These lookups are
  // independent — run them concurrently so a cold cache doesn't stack
  // round-trips ahead of the turn (and its 👀 receipt).
  const joinedExistingThread = isNew && Boolean(event.thread_ts) && event.thread_ts !== event.ts
  const [threadContext, senderName, channelName] = await Promise.all([
    joinedExistingThread
      ? fetchThreadContextSafe(
          runtime.botToken,
          slackWorkspaceId,
          event.channel,
          slackThreadTs,
          event.ts,
        )
      : Promise.resolve(undefined),
    fetchSlackUserName(runtime.botToken, slackWorkspaceId, event.user),
    fetchSlackChannelName(runtime.botToken, slackWorkspaceId, event.channel),
  ])

  const transcriptThreadKey = {
    slackWorkspaceId,
    slackChannelId: event.channel,
    slackThreadTs,
  }
  const resolvedText = await resolveSlackMentionNames(runtime.botToken, slackWorkspaceId, text)

  await appendSlackThreadMessage(transcriptThreadKey, {
    ts: event.ts,
    authorName: senderName ?? `<@${event.user}>`,
    text: resolvedText,
  }).catch(() => {})

  const mentionAttachments = await ingestSlackAttachments({
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
    threadTs: slackThreadTs,
    messageTs: event.ts,
    userId: event.user,
    userName: senderName,
  })
  const renderedText = appendMessageOriginLine(
    appendAttachmentNote(
      renderSlackUserMessage(event, resolvedText || '(shared a file)', {
        senderName,
        channelName,
        threadContext,
      }),
      mentionAttachments.note,
    ),
    messageOrigin,
  )
  const claim = await claimSlackTurnOrQueue({
    runtime,
    userId: thread.agentUserId,
    sessionId: thread.sessionId,
    channel: event.channel,
    threadTs: slackThreadTs,
    eventId,
    renderedText,
    actorUserId: userMapping.nuphosUserId,
    reactionMessageTs: event.ts,
  })

  if (!claim) return
  const releaseAgentRunClaim = claim.release

  beginThreadStatus(runtime, event.channel, slackThreadTs)

  try {
    const turnIdentity = getSlackThreadTurnIdentity(thread, userMapping.nuphosUserId)
    const messages = await buildMessagesForRenderedTurn({
      sessionId: thread.sessionId,
      userId: turnIdentity.conversationOwnerUserId,
      teamId: thread.teamId,
      messageId: `slack-${event.event_ts ?? event.ts ?? randomUUID()}`,
      renderedText,
      carried: claim.carried,
      actorUserId: userMapping.nuphosUserId,
      attachmentParts: mentionAttachments.parts,
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
      threadTs: slackThreadTs,
      // Signed for the sender — in a thread someone else started, the turn
      // still runs in the owner's session but must not borrow their token
      // (mirrors handleThreadMessage's fail-closed sender resolution).
      nuphosToken: signNuphosToken(userMapping.nuphosUserId, 60 * 60 * 8),
      sender: { slackUserId: event.user, displayName: senderName },
      messages,
      firstMessage: resolvedText,
      reactionMessageTs: event.ts,
      // In a channel conversation the channel itself is the search context.
      contextChannelId: event.channel,
      actionToken: event.action_token,
      transcriptThreadKey,
    })
  } finally {
    releaseAgentRunClaim()
  }
}
