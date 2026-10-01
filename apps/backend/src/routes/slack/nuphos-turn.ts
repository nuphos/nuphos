import { pausedTurnKind } from '@/lib/agent/round-continuation'
import { logError, logEvent } from '@/lib/observability'
import { appendSlackThreadMessage, getSlackUserMappingForNuphosUser } from '@/lib/slack/agent-bot'
import { postAgentSlackMessage } from '@/lib/slack/agent-message'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { SlackAgentRunSink } from '@/lib/slack/stream-sink'
import { fetchSlackUserName } from '@/lib/slack/user-profile'
import { slackAgentErrorNotice } from '@/routes/slack/agent-error-notice'
import { postAgentProducedFiles } from '@/routes/slack/attachments'
import { postNuphosInteropMessage } from '@/routes/slack/nuphos-interop'
import { postPlanApprovalCards } from '@/routes/slack/plan-cards'
import { createSlackReplyToolContext } from '@/routes/slack/reply-tools'
import { setAssistantStatusSafe } from '@/routes/slack/status'
import { recordSlackTurnTranscript } from '@/routes/slack/turn'

import type { SlackAgentThread } from '@/lib/slack/agent-bot'

export type NuphosSlackTurnOutcome = {
  /** The user pressed Stop in Nuphos before the turn finished. */
  stopped: boolean
  /** The run threw out of the route's pump (not just an error frame). */
  error?: unknown
  /** Why the pump reported the turn paused, when it did. */
  pauseReason?: string
}

export type NuphosSlackTurnDelivery = {
  slackReply: ReturnType<typeof createSlackReplyToolContext>
  frameSink: SlackAgentRunSink
  /**
   * Runs after the route's pump has finished (success, stop, or throw):
   * delivers buffered text, error/stop/pause notices, plan and permission
   * cards, the thread-transcript record, and produced files. Never throws.
   */
  finalize: (outcome: NuphosSlackTurnOutcome) => Promise<void>
}

// Pause reasons the Nuphos desktop client resumes on its own (its
// RECOVERABLE_PAUSE_REASONS in apps/desktop/src/components/agent/panel/
// model.ts) — the continuation keeps posting into this thread, so a notice
// would be noise. Every OTHER pause waits on a human, and the thread must not
// go silently dark mid-work.
const CLIENT_AUTO_RESUMED_PAUSE_REASONS = new Set(['model-silence', 'tool-execution-timeout'])

/**
 * Set up Slack delivery for a turn the conversation owner typed in the Nuphos
 * app on a Slack-bound conversation: post the "@Name says:" interop message
 * into the thread (when `mirror` is set), then relay the run's frames into
 * paced thread replies via the returned frame sink, exactly like a
 * Slack-originated turn.
 *
 * Returns null when the mirror cannot be set up (no bot installed for the
 * workspace any more) — the turn then runs un-mirrored: Slack delivery is
 * best-effort by contract, and a Slack-side outage must not take away the
 * owner's ability to use their own conversation. The caller holds the
 * per-session run claim either way.
 */
export async function beginNuphosSlackTurn(args: {
  thread: SlackAgentThread
  /** The conversation owner sending this turn (owner-only writability). */
  userId: string
  /** The sender's Nuphos display name, the fallback when no Slack mapping exists. */
  userName: string
  streamId: string
  /**
   * The new user message to post as the "@Name says:" interop. Null for
   * continuations (client-tool outputs, pause resume) and duplicate retries —
   * only the reply mirroring is attached then.
   */
  mirror: { messageId: string; questionText: string; attachmentCount: number } | null
}): Promise<NuphosSlackTurnDelivery | null> {
  const { thread, mirror } = args
  const threadKey = {
    slackWorkspaceId: thread.slackWorkspaceId,
    slackChannelId: thread.slackChannelId,
    slackThreadTs: thread.slackThreadTs,
  }
  const bot = await resolveSlackBotForWorkspace(thread.slackWorkspaceId).catch((err: unknown) => {
    logError('slack.nuphos_turn.bot_resolve_error', err, {
      slack_workspace_id: thread.slackWorkspaceId,
      session_id: thread.sessionId,
    })

    return null
  })

  if (!bot) {
    logEvent('warn', 'slack.nuphos_turn.mirror_unavailable', {
      slack_workspace_id: thread.slackWorkspaceId,
      slack_channel_id: thread.slackChannelId,
      session_id: thread.sessionId,
    })

    return null
  }
  const runtime = { botToken: bot.botToken, botUserId: bot.botUserId }
  // Prefer the sender's Slack identity so the thread reads like the person
  // spoke; the Nuphos name covers unmapped users. The mapping is a local
  // lookup, but the display name is a Slack HTTP call (10s timeout) — it must
  // NOT hold up the model request, so only the interop post and transcript
  // record wait on it; the system prompt uses the Nuphos name. Rendered as
  // plain bold text, never a real <@…> mention — the bot mentioning the
  // author would notify them about their own message on every turn.
  const mapping = await getSlackUserMappingForNuphosUser(
    thread.slackWorkspaceId,
    thread.teamId,
    args.userId,
  ).catch((err: unknown) => {
    logError('slack.nuphos_turn.sender_resolve_error', err, {
      slack_workspace_id: thread.slackWorkspaceId,
      session_id: thread.sessionId,
    })

    return null
  })
  const sender = mapping
    ? { slackUserId: mapping.slackUserId, displayName: args.userName }
    : undefined
  const displayNamePromise: Promise<string> = mapping
    ? fetchSlackUserName(runtime.botToken, thread.slackWorkspaceId, mapping.slackUserId)
        .then((name) => name ?? args.userName)
        .catch(() => args.userName)
    : Promise.resolve(args.userName)

  // Never rejects. The sink's poster awaits it so the "@Name says:" line is in
  // the thread before the first mirrored reply, without delaying the Nuphos
  // stream's first token.
  const interopPosted = mirror
    ? displayNamePromise.then((displayName) =>
        postNuphosInteropMessage({
          token: runtime.botToken,
          channel: thread.slackChannelId,
          threadTs: thread.slackThreadTs,
          displayName,
          question: mirror.questionText,
          attachmentCount: mirror.attachmentCount,
        }),
      )
    : Promise.resolve()

  if (mirror) {
    // Deterministic ts so a retried send cannot double-record; the addressing
    // judge needs the question in the rolling transcript to read follow-ups.
    void displayNamePromise
      .then((displayName) =>
        appendSlackThreadMessage(threadKey, {
          ts: `nuphos:${mirror.messageId}`,
          authorName: displayName,
          text: mirror.questionText,
        }),
      )
      .catch(() => {})
  }

  const sink = new SlackAgentRunSink(
    async (text) => {
      await interopPosted

      return await postAgentSlackMessage({
        token: runtime.botToken,
        channel: thread.slackChannelId,
        threadTs: thread.slackThreadTs,
        text,
      })
    },
    (status) => {
      void setAssistantStatusSafe(
        runtime.botToken,
        thread.slackChannelId,
        thread.slackThreadTs,
        status,
      )
    },
  )
  const slackReply = createSlackReplyToolContext({
    token: runtime.botToken,
    channel: thread.slackChannelId,
    contextChannelId: thread.slackChannelId,
    sender,
  })

  slackReply.nuphosOriginated = true
  // Files are matched to this turn by creation time (the transfer store has no
  // per-turn marker), so stamp the boundary before the run starts.
  const turnStartedAt = new Date()

  const finalize = async (outcome: NuphosSlackTurnOutcome): Promise<void> => {
    try {
      await sink.settle()
      if (outcome.stopped) {
        await sink.say('_Stopped from Nuphos._')
      } else if (outcome.error !== undefined) {
        await sink.say(slackAgentErrorNotice(outcome.error))
      } else if (sink.terminal() === 'error') {
        await sink.say(slackAgentErrorNotice(undefined))
      } else if (
        sink.terminal() === 'paused' &&
        !CLIENT_AUTO_RESUMED_PAUSE_REASONS.has(outcome.pauseReason ?? '')
      ) {
        // A pause the client will NOT auto-resume (budget, deadline) waits on
        // a human; without this line the thread goes dark mid-work.
        await sink.say(
          pausedTurnKind(outcome.pauseReason) === 'budget-exhausted'
            ? '_This task was too long to finish in one turn. Reply in this thread, or continue it from Nuphos, and I will pick up where I left off._'
            : '_This turn stopped before finishing. Reply in this thread, or continue it from Nuphos, to pick it back up._',
        )
      }
      const postedPlanCards = await postPlanApprovalCards({
        runtime,
        channel: thread.slackChannelId,
        threadTs: thread.slackThreadTs,
        teamId: thread.teamId,
        agentUserId: args.userId,
        sessionId: thread.sessionId,
        plans: slackReply.getCreatedPlans(),
      })

      await setAssistantStatusSafe(
        runtime.botToken,
        thread.slackChannelId,
        thread.slackThreadTs,
        '',
      )
      await recordSlackTurnTranscript(
        threadKey,
        `bot:nuphos:${args.streamId}`,
        sink,
        postedPlanCards,
      )
    } catch (err) {
      // A Slack delivery failure past this point has nowhere better to go:
      // the Nuphos user already has the real outcome on their own surface.
      logError('slack.nuphos_turn.finalize_error', err, {
        slack_channel_id: thread.slackChannelId,
        slack_thread_ts: thread.slackThreadTs,
        session_id: thread.sessionId,
      })
    } finally {
      // Detached: uploads can take minutes and must not hold up the caller.
      // Never rejects: every failure is handled inside.
      void postAgentProducedFiles({
        runtime,
        channel: thread.slackChannelId,
        threadTs: thread.slackThreadTs,
        teamId: thread.teamId,
        sessionId: thread.sessionId,
        since: turnStartedAt,
      })
    }
  }

  return { slackReply, frameSink: sink, finalize }
}
