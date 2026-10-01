import { pausedTurnKind } from '@/lib/agent/round-continuation'
import { turnRunner } from '@/lib/agent/turn-runner'
import { listSessionDownloadsSince } from '@/lib/file-transfer/service'
import { getLarkUserMapping, markLarkEvent } from '@/lib/lark/agent-bot'
import { fetchLarkUser, replyLarkMessage, sendLarkMessage } from '@/lib/lark/api'
import { shareTransferGroupsToLarkChat } from '@/lib/lark/files'
import { LarkCardStream } from '@/lib/lark/stream'
import { LarkAgentRunSink } from '@/lib/lark/stream-sink'
import { parseObjectId } from '@/lib/objectid'
import { logError } from '@/lib/observability'

import type { LarkUserMapping } from '@/lib/lark/agent-bot'
import type { LarkAppContext } from '@/lib/lark/api'
import type { UIMessage } from 'ai'

// ─── User resolution ─────────────────────────────────────────────────────────
// A custom app's tenant token can't read a sender's email (Feishu gates email
// behind user-level OAuth), so there is no email auto-map — members link
// themselves with a DM pair code. fetchLarkUser stays for the display name.
export async function resolveLarkUser(args: {
  ctx: LarkAppContext
  appId: string
  teamId: string
  openId: string
}): Promise<{ mapping: LarkUserMapping | null; name: string | null }> {
  const existing = await getLarkUserMapping(args.appId, args.teamId, args.openId)
  const profile = await fetchLarkUser({ ctx: args.ctx, openId: args.openId })

  return { mapping: existing, name: profile.name }
}

export async function replyNotice(
  ctx: LarkAppContext,
  chatId: string,
  text: string,
): Promise<void> {
  await sendLarkMessage({
    ctx,
    receiveIdType: 'chat_id',
    receiveId: chatId,
    msgType: 'text',
    content: JSON.stringify({ text }),
  }).catch(() => {})
}

// A notice that asks the user to reply must land in the thread the turn ran in.
// Incoming messages route to a session by root_id/thread_id, so a plain
// chat_id notice would become its own root and answering it would open a fresh
// session instead of resuming the paused turn.
// Still best-effort — the turn's work is already delivered and done, so a
// failed notice must not fail the turn — but never silent: losing it leaves the
// user with a thread that stops mid-task and no prompt to resume it.
async function replyThreadNotice(args: {
  ctx: LarkAppContext
  chatId: string
  rootMessageId: string
  sessionId: string
  replyInThread: boolean
  text: string
}): Promise<void> {
  try {
    await replyLarkMessage({
      ctx: args.ctx,
      messageId: args.rootMessageId,
      msgType: 'text',
      content: JSON.stringify({ text: args.text }),
      replyInThread: args.replyInThread,
    })
  } catch (err) {
    logError('lark.agent.thread_notice.error', err, {
      lark_chat_id: args.chatId,
      lark_root_message_id: args.rootMessageId,
      session_id: args.sessionId,
    })
  }
}

// ─── Turn execution ──────────────────────────────────────────────────────────
export async function executeLarkAgentTurn(args: {
  ctx: LarkAppContext
  chatId: string
  rootMessageId: string
  isGroup: boolean
  teamId: string
  agentUserId: string
  sessionId: string
  nuphosToken: string
  messages: UIMessage[]
  firstMessage: string
  sender: { openId: string; displayName?: string | null }
  eventId: string
}): Promise<void> {
  const stream = new LarkCardStream({
    ctx: args.ctx,
    chatId: args.chatId,
    rootMessageId: args.rootMessageId,
    // Group @mention → reply into a topic thread; DM → reply inline.
    replyInThread: args.isGroup,
  })
  const sink = new LarkAgentRunSink(stream, args.sessionId)
  // Files are matched to this turn by creation time (the transfer store has no
  // per-turn marker), so stamp the boundary before the run starts.
  const turnStartedAt = new Date()

  // Instant feedback: post a "思考中" card before the agent produces anything.
  sink.begin()
  try {
    const outcome = await turnRunner.runAgentForTrigger({
      userId: args.agentUserId,
      nuphosToken: args.nuphosToken,
      teamId: args.teamId,
      sessionId: args.sessionId,
      messages: args.messages,
      firstMessage: args.firstMessage,
      source: 'lark.agent',
      larkReply: { sender: args.sender },
      frameSink: sink,
    })

    await sink.settle()
    if (sink.terminal() === 'paused') {
      // Same close-out as Slack: the turn stopped mid-work after spending its
      // automatic continuations, so say so rather than ending on silence.
      await replyThreadNotice({
        ctx: args.ctx,
        chatId: args.chatId,
        rootMessageId: args.rootMessageId,
        sessionId: args.sessionId,
        replyInThread: args.isGroup,
        text:
          pausedTurnKind(outcome.pauseReason) === 'budget-exhausted'
            ? "This task needs more than one turn — reply in this thread and I'll pick up from where I left off."
            : "This turn was interrupted before it finished — reply in this thread and I'll resume.",
      })
    }
    await markLarkEvent(args.eventId, 'completed')
  } catch (err) {
    logError('lark.agent.turn.error', err, {
      event_id: args.eventId,
      lark_chat_id: args.chatId,
      session_id: args.sessionId,
    })
    await markLarkEvent(args.eventId, 'failed', err instanceof Error ? err.message : String(err))
    try {
      sink.markFailed()
      await sink.settle()
      await replyNotice(
        args.ctx,
        args.chatId,
        'Nuphos hit an error handling this request — diagnostic info was captured for the team to look into.',
      )
    } catch {
      // The failure notice itself failed; the turn error is already logged.
    }
  } finally {
    // Attach files the turn pushed, DETACHED and after the reply is finalized:
    // uploads can take minutes and must hold open neither the card stream nor
    // the per-session run claim the caller releases when this returns. Reached
    // on success and error alike — files pushed before a mid-turn failure are
    // still delivered, since the transfer store is decoupled from the run.
    void postLarkAgentProducedFiles({
      ctx: args.ctx,
      rootMessageId: args.rootMessageId,
      replyInThread: args.isGroup,
      teamId: args.teamId,
      sessionId: args.sessionId,
      since: turnStartedAt,
    })
  }
}

// Mirrors postAgentProducedFiles in routes/slack.ts. Best-effort: a failed
// attachment must never fail the turn (the desktop download card still exists
// either way). Never rejects — every failure is handled inside.
async function postLarkAgentProducedFiles(args: {
  ctx: LarkAppContext
  rootMessageId: string
  replyInThread: boolean
  teamId: string
  sessionId: string
  since: Date
}): Promise<void> {
  try {
    const groups = await listSessionDownloadsSince({
      teamId: parseObjectId(args.teamId, 'teamId'),
      sessionId: args.sessionId,
      since: args.since,
    })

    if (groups.length === 0) return
    await shareTransferGroupsToLarkChat({
      ctx: args.ctx,
      rootMessageId: args.rootMessageId,
      replyInThread: args.replyInThread,
      groups,
    })
  } catch (err) {
    logError('lark.files.share.error', err, {
      session_id: args.sessionId,
      lark_root_message_id: args.rootMessageId,
    })
  }
}
