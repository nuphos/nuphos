import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { buildPendingUserMessage } from '@/lib/agent/pending-messages'
import { turnRunner } from '@/lib/agent/turn-runner'
import { signNuphosToken } from '@/lib/identity'
import {
  claimLarkEvent,
  consumeLarkPairCode,
  getLarkChatMappingAny,
  getLarkUserMapping,
  getOrCreateLarkAgentThread,
  markLarkEvent,
  normalizeLarkPairCode,
  upsertLarkChatMapping,
  upsertLarkUserMapping,
} from '@/lib/lark/agent-bot'
import { getLarkGroup } from '@/lib/lark/destinations'
import { logError, logEvent } from '@/lib/observability'

import { ingestLarkAttachments, parseLarkAttachments, parseLarkText } from './attachments'
import { buildMessagesForLarkTurn } from './transcript'
import { executeLarkAgentTurn, replyNotice, resolveLarkUser } from './turn'

import type { ResolvedLarkApp } from '@/lib/lark/installations'

// ─── Message dispatch ────────────────────────────────────────────────────────
export type LarkMessageEvent = {
  header?: { event_id?: string }
  event?: {
    sender?: { sender_id?: { open_id?: string } }
    message?: {
      message_id?: string
      chat_id?: string
      chat_type?: string
      message_type?: string
      content?: string
      root_id?: string
      thread_id?: string
      mentions?: { key?: string; name?: string }[]
    }
  }
}

export async function handleLarkMessage(
  app: ResolvedLarkApp,
  body: LarkMessageEvent,
): Promise<void> {
  const { ctx, binding } = app
  const appId = binding.appId
  const teamId = app.nuphosTeamId
  const eventId = body.header?.event_id
  const message = body.event?.message
  const openId = body.event?.sender?.sender_id?.open_id

  if (!eventId || !message?.message_id || !message.chat_id || !openId) return

  const chatId = message.chat_id
  const messageId = message.message_id
  const chatType = message.chat_type ?? 'group'

  if (!(await claimLarkEvent({ eventId, appId, chatId }))) return

  try {
    const text = parseLarkText(message)
    const attachmentRefs = parseLarkAttachments(message)

    if (!text && attachmentRefs.length === 0) {
      await markLarkEvent(eventId, 'ignored')

      return
    }

    // Group @mentions: the custom app belongs to this one team, so any group its
    // bot is in is legitimately theirs — auto-link on first mention so onboarding
    // is just "add the bot to the group and @mention it". An admin can still
    // disable a group in the desktop, which we honour by staying silent.
    if (chatType !== 'p2p') {
      const existing = await getLarkChatMappingAny(appId, chatId)

      if (existing && !existing.enabled) {
        await markLarkEvent(eventId, 'ignored')

        return
      }
      if (!existing) {
        const info = await getLarkGroup(ctx, chatId).catch(() => null)

        await upsertLarkChatMapping({
          appId,
          chatId,
          teamId,
          createdBy: 'auto:lark-mention',
          ...(info?.name ? { name: info.name } : {}),
        })
        logEvent('info', 'lark.agent.chat_mapping.auto_link', {
          team_id: teamId,
          lark_app_id: appId,
          lark_chat_id: chatId,
          source: 'mention',
        })
      }
    }

    // DM pair-code linking: a member DMs the short code shown in the desktop app
    // to bind their own Lark account. This is the only self-serve path — a custom
    // app's tenant token can't read a sender's email to auto-map them.
    if (chatType === 'p2p') {
      const code = normalizeLarkPairCode(text)

      if (code) {
        const pending = await consumeLarkPairCode({ code, teamId })

        if (pending) {
          // Redeeming a code rebinds this openId. If it was already linked to a
          // *different* Nuphos user, that user silently loses the mapping — leave
          // an audit trail rather than overwriting without a trace.
          const prior = await getLarkUserMapping(appId, teamId, openId)

          if (prior && prior.nuphosUserId !== pending.nuphosUserId) {
            logEvent('warn', 'lark.agent.user_mapping.rebind', {
              team_id: teamId,
              lark_app_id: appId,
              lark_open_id: openId,
              prior_nuphos_user_id: prior.nuphosUserId,
              new_nuphos_user_id: pending.nuphosUserId,
            })
          }
          await upsertLarkUserMapping({
            appId,
            larkOpenId: openId,
            teamId,
            nuphosUserId: pending.nuphosUserId,
            createdBy: 'pair-code',
          })
          logEvent('info', 'lark.agent.user_mapping.pair_code_link', {
            team_id: teamId,
            lark_app_id: appId,
            lark_open_id: openId,
          })
          await replyNotice(
            ctx,
            chatId,
            "✅ You're linked — your Lark account is now connected to Nuphos. Message me here anytime, or @mention me in a group.",
          )
        } else if (!(await getLarkUserMapping(appId, teamId, openId))) {
          // Code not found AND the sender isn't linked → a genuinely bad/expired
          // code. If they ARE already linked, this is a duplicate/retry of an
          // already-redeemed code (Feishu redelivers events it couldn't ack, and
          // a frustrated user often DMs the code several times) — stay silent
          // rather than nag "expired" minutes after a successful link.
          await replyNotice(
            ctx,
            chatId,
            'That pairing code is invalid or expired. Open the Nuphos desktop app → Connectors → Lark, generate a fresh code, and DM it to me.',
          )
        }
        await markLarkEvent(eventId, 'completed')

        return
      }
    }

    const { mapping: userMapping, name } = await resolveLarkUser({ ctx, appId, teamId, openId })

    if (!userMapping) {
      await replyNotice(
        ctx,
        chatId,
        "I couldn't match your Lark account to a Nuphos user yet. Open the Nuphos desktop app → Connectors → Lark, generate a pairing code, and DM it to me to link your account.",
      )
      await markLarkEvent(eventId, 'completed')

      return
    }

    // One agent session per thread. p2p has no threads → key on the chat.
    const threadId = chatType === 'p2p' ? chatId : message.thread_id || message.root_id || messageId
    const { thread } = await getOrCreateLarkAgentThread({
      appId,
      chatId,
      threadId,
      teamId,
      agentUserId: userMapping.nuphosUserId,
      createdByLarkOpenId: openId,
      lastLarkEventId: eventId,
    })

    // A thread's session is bound to its creator's Nuphos identity; never let a
    // different participant drive it (they would act as the creator).
    if (thread.createdByLarkOpenId !== openId) {
      await replyNotice(
        ctx,
        chatId,
        'This thread belongs to another teammate. Start a new message and @mention me to open your own thread.',
      )
      await markLarkEvent(eventId, 'completed')

      return
    }

    const senderName = name?.trim() || 'a teammate'
    const attachments = await ingestLarkAttachments({
      ctx,
      message,
      teamId: thread.teamId,
      userId: thread.agentUserId,
      sessionId: thread.sessionId,
    })
    const renderedText = attachments.note
      ? `${text || '(shared a file)'}\n\n${attachments.note}`
      : text
    const metadata = await createMessageMetadata(thread.agentUserId, 'lark')
    // A message that arrives mid-turn is handed to the turn in flight rather
    // than refused: the agent sees it at its next step and decides whether to
    // ignore it, finish first, or change course.
    const claim = await turnRunner.claimAgentRunOrEnqueue({
      userId: thread.agentUserId,
      sessionId: thread.sessionId,
      message: buildPendingUserMessage({
        renderedText,
        source: 'lark',
        metadata,
        actorUserId: thread.agentUserId,
      }),
    })

    if (claim.mode === 'dropped') {
      await replyNotice(
        ctx,
        chatId,
        "I'm mid-way through the previous message and couldn't hold on to that one — send it again in a moment.",
      )
      await markLarkEvent(eventId, 'completed')

      return
    }
    if (claim.mode === 'queued') {
      await markLarkEvent(eventId, 'completed')

      return
    }
    const release = claim.release

    try {
      const messages = await buildMessagesForLarkTurn({
        sessionId: thread.sessionId,
        userId: thread.agentUserId,
        teamId: thread.teamId,
        renderedText,
        metadata,
        carried: claim.carried,
        attachmentParts: attachments.parts,
      })

      await executeLarkAgentTurn({
        ctx,
        chatId,
        rootMessageId: messageId,
        isGroup: chatType !== 'p2p',
        teamId: thread.teamId,
        agentUserId: thread.agentUserId,
        sessionId: thread.sessionId,
        // Act as the mapped user, run-scoped token (same shape as trigger fires).
        nuphosToken: signNuphosToken(thread.agentUserId, 60 * 60 * 8),
        messages,
        firstMessage: text,
        sender: { openId, displayName: senderName },
        eventId,
      })
    } finally {
      release()
    }
  } catch (err) {
    logError('lark.agent.message.error', err, {
      event_id: eventId,
      lark_app_id: appId,
      lark_chat_id: chatId,
    })
    await markLarkEvent(eventId, 'failed', err instanceof Error ? err.message : String(err))
  }
}
