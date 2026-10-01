import { pausedTurnKind } from '@/lib/agent/round-continuation'
import { turnRunner } from '@/lib/agent/turn-runner'
import { resolvePreviewDecisionByRef } from '@/lib/claude-code-preview/decision-waiter'
import { logError } from '@/lib/observability'
import { appendSlackThreadMessage, markSlackEvent } from '@/lib/slack/agent-bot'
import { postAgentSlackMessage } from '@/lib/slack/agent-message'
import { SlackAgentRunSink } from '@/lib/slack/stream-sink'
import { slackAgentErrorNotice } from '@/routes/slack/agent-error-notice'
import { postAgentProducedFiles } from '@/routes/slack/attachments'
import { postPlanApprovalCards } from '@/routes/slack/plan-cards'
import { createSlackReplyToolContext } from '@/routes/slack/reply-tools'
import { addReactionSafe, RECEIPT_REACTION } from '@/routes/slack/shared'
import { setAssistantStatusSafe } from '@/routes/slack/status'
import { postToolApprovalCard } from '@/routes/slack/tool-approval-cards'

import type { PostedPlanCard } from '@/routes/slack/plan-cards'
import type { SlackRuntime, SlackThreadKey } from '@/routes/slack/types'
import type { UIMessage } from 'ai'

type SlackAgentTurnArgs = {
  runtime: SlackRuntime
  // Slack event this turn answers; null for synthetic turns (plan approval).
  eventId: string | null
  sessionId: string
  // The original owner is used only for the durable conversation/session.
  agentUserId: string
  // The Nuphos user who sent this turn. Shared channel replies execute with
  // this user's credentials and permissions, never the conversation owner's.
  actorUserId?: string
  teamId: string
  channel: string
  threadTs: string
  nuphosToken: string
  messages: UIMessage[]
  firstMessage: string
  // Who sent the message that started the turn. Rendered transcripts carry
  // display names only, so this is how the model gets the Slack user id it
  // needs to @-mention the sender. Absent for synthetic turns.
  sender?: { slackUserId: string; displayName?: string | null }
  // The user message that started the turn; enables the 👀 receipt and the
  // agent's slack_react tool. Absent for synthetic turns.
  reactionMessageTs?: string
  contextChannelId?: string
  actionToken?: string
  // Runs after the reply is fully delivered but before control returns (e.g.
  // clearing the assistant DM "is thinking…" status).
  afterFinish?: () => Promise<void>
  // Set for channel threads so the reply joins the thread's rolling transcript
  // (the addressing judge reads it). Omitted for assistant DMs, where every
  // message is addressed to the bot by definition.
  transcriptThreadKey?: SlackThreadKey
}

/**
 * The reply tail + any approval cards, recorded into the thread's rolling
 * transcript AFTER the reply is delivered, so the window mirrors what the
 * thread actually shows: the answer, then the card asking for approval.
 * Without the card line the addressing judge sees a bare "approve" with
 * nothing to attach it to and reads it as chatter. Deterministic ts, so a
 * re-posted card records once. Shared with the Nuphos-typed mirror turn
 * (routes/slack/nuphos-turn.ts).
 */
export async function recordSlackTurnTranscript(
  transcriptThreadKey: SlackThreadKey,
  botTs: string,
  sink: SlackAgentRunSink,
  postedPlanCards: PostedPlanCard[],
): Promise<void> {
  await appendSlackThreadMessage(transcriptThreadKey, {
    ts: botTs,
    authorName: 'Nuphos',
    text: sink.replyTail() || '(no visible reply)',
    fromBot: true,
  }).catch(() => {})
  for (const card of postedPlanCards) {
    await appendSlackThreadMessage(transcriptThreadKey, {
      ts: `bot:plan-card:${card.planId}`,
      authorName: 'Nuphos',
      text: `Posted the plan "${card.title}" for review and is waiting for it to be approved.`,
      fromBot: true,
    }).catch(() => {})
  }
}

// The shared Slack turn pipeline: the agent run's frame stream becomes plain
// thread replies paced like a person's — each thing the agent says posts when
// it heads into its next tool call, not in one burst when the turn ends —
// then plan review cards, produced-file attachments, and finalization.
// Callers hold the per-session run claim. Never throws: Slack delivery is
// best-effort and failures are logged + surfaced into the thread where
// possible.
export async function executeSlackAgentTurn(args: SlackAgentTurnArgs): Promise<void> {
  // Files are matched to this turn by creation time (the transfer store has no
  // per-turn marker), so stamp the boundary before the run starts.
  const turnStartedAt = new Date()
  // The sink drives the thread's status line instead of leaving a tool
  // timeline behind: the user sees what the agent is on right now, and the
  // thread keeps only the answer.
  const sink = new SlackAgentRunSink(
    (text) =>
      postAgentSlackMessage({
        token: args.runtime.botToken,
        channel: args.channel,
        threadTs: args.threadTs,
        text,
      }),
    (status) => {
      void setAssistantStatusSafe(args.runtime.botToken, args.channel, args.threadTs, status)
    },
    async (request) => {
      const toolCallId = typeof request.toolCallId === 'string' ? request.toolCallId : undefined
      const options = Array.isArray(request.options)
        ? request.options.flatMap((option) => {
            if (!option || typeof option !== 'object') return []
            const value = option as Record<string, unknown>

            return typeof value.optionId === 'string' &&
              typeof value.name === 'string' &&
              typeof value.kind === 'string'
              ? [{ optionId: value.optionId, name: value.name, kind: value.kind }]
              : []
          })
        : []

      if (!toolCallId) return
      try {
        await postToolApprovalCard({
          runtime: args.runtime,
          channel: args.channel,
          threadTs: args.threadTs,
          sessionId: args.sessionId,
          toolCallId,
          title:
            typeof request.toolLabel === 'string' ? request.toolLabel : 'Run the requested tool',
          options,
        })
      } catch (err) {
        logError('slack.tool_approval.card.error', err, {
          session_id: args.sessionId,
          tool_call_id: toolCallId,
          slack_channel_id: args.channel,
        })
        // The runtime is synchronously waiting for this decision. A card that
        // never reached Slack must fail closed immediately, not strand the
        // entire turn until a transport timeout.
        await resolvePreviewDecisionByRef({
          kind: 'agent-permission',
          ref: toolCallId,
          payload: { decision: 'rejected', reason: 'slack_card_delivery_failed' },
        })
      }
    },
  )
  const slackReply = createSlackReplyToolContext({
    token: args.runtime.botToken,
    channel: args.channel,
    messageTs: args.reactionMessageTs,
    contextChannelId: args.contextChannelId,
    actionToken: args.actionToken,
    sender: args.sender,
  })
  // Recorded into the thread transcript in the finally below, AFTER the reply
  // tail, so the rolling window mirrors what the thread actually shows: the
  // answer, then the card asking for approval.
  let postedPlanCards: PostedPlanCard[] = []

  try {
    // 👀 on the user's own message marks WHICH message was picked up — useful
    // when several arrived at once.
    if (args.reactionMessageTs) {
      await addReactionSafe(
        args.runtime.botToken,
        args.channel,
        args.reactionMessageTs,
        RECEIPT_REACTION,
      )
    }
    // The "on it" line the thread sees first is the model's own, written
    // before its first tool call (see the acknowledgement section of the system
    // prompt). Nothing is posted from here: a canned line would be the same
    // sentence every time and could not name what it is about to look at.
    const outcome = await turnRunner.runAgentForTrigger({
      userId: args.actorUserId ?? args.agentUserId,
      conversationOwnerUserId: args.agentUserId,
      nuphosToken: args.nuphosToken,
      teamId: args.teamId,
      sessionId: args.sessionId,
      messages: args.messages,
      firstMessage: args.firstMessage,
      source: 'slack.agent',
      slackReply,
      frameSink: sink,
    })

    await sink.settle()
    if (sink.terminal() === 'paused') {
      // The turn ran out of budget and out of automatic continuations, or the
      // stall watchdog cut it. Either way it stopped mid-work and only a new
      // user message resumes it — without this note the thread goes quiet.
      await sink.say(
        pausedTurnKind(outcome.pauseReason) === 'budget-exhausted'
          ? '_This task was too long to finish in one turn. Reply in this thread and I will pick up where I left off._'
          : '_This turn stopped responding before finishing. Reply in this thread to pick it back up._',
      )
    } else if (sink.terminal() === 'error') {
      // The run ended on an error frame without runAgentForTrigger throwing
      // (the pump reports stream errors as frames); tell the thread instead of
      // going silent.
      await sink.say(
        'Nuphos hit an error while handling this request. The team has enough trace metadata to investigate.',
      )
    }
    postedPlanCards = await postPlanApprovalCards({
      runtime: args.runtime,
      channel: args.channel,
      threadTs: args.threadTs,
      teamId: args.teamId,
      agentUserId: args.actorUserId ?? args.agentUserId,
      sessionId: args.sessionId,
      plans: slackReply.getCreatedPlans(),
    })
    if (args.eventId) await markSlackEvent(args.eventId, 'completed')
  } catch (err) {
    logError('slack.agent.event.error', err, {
      event_id: args.eventId ?? undefined,
      slack_channel_id: args.channel,
      slack_thread_ts: args.threadTs,
      session_id: args.sessionId,
    })
    if (args.eventId) {
      await markSlackEvent(args.eventId, 'failed', err instanceof Error ? err.message : String(err))
    }
    // Deliver whatever the run did produce, then the error notice. Do NOT
    // rethrow: a Slack delivery failure past this point has nowhere better to
    // go.
    try {
      await sink.settle()
      await sink.say(slackAgentErrorNotice(err))
    } catch {
      // The error notice itself failed; there is no further channel to try.
    }
  } finally {
    // Deliver anything still buffered exactly once, then run the caller's
    // cleanup even if delivery rejects.
    try {
      await sink.settle()
    } finally {
      if (args.transcriptThreadKey) {
        await setAssistantStatusSafe(args.runtime.botToken, args.channel, args.threadTs, '')
        await recordSlackTurnTranscript(
          args.transcriptThreadKey,
          `bot:${String(args.reactionMessageTs ?? Date.now())}`,
          sink,
          postedPlanCards,
        )
      }
      try {
        await args.afterFinish?.()
      } finally {
        // Attach files the turn pushed only AFTER the reply is delivered and
        // the assistant status is cleared, and DETACHED: uploads can take
        // minutes (up to 120s per file) and must not hold open the per-session
        // run claim the caller releases when this returns. One call site, reached on success and error paths
        // alike (files pushed before a mid-turn failure are still delivered —
        // the transfer store is decoupled from the run), so a single turn can
        // never share twice. Never rejects: every failure is handled inside.
        void postAgentProducedFiles({
          runtime: args.runtime,
          channel: args.channel,
          threadTs: args.threadTs,
          teamId: args.teamId,
          sessionId: args.sessionId,
          since: turnStartedAt,
        })
      }
    }
  }
}
