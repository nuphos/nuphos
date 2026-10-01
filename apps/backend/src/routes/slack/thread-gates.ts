import { hasPlanAwaitingApprovalForConversation } from '@/lib/agent/plans'
import { judgeThreadAddressing } from '@/lib/agent/thread-addressing'
import { THREAD_ADDRESSING_PROMPT_VERSION } from '@/lib/agent/thread-addressing-core'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import {
  getSlackChannelMapping,
  markSlackEvent,
  recordSlackAddressingVerdict,
} from '@/lib/slack/agent-bot'
import { getAgentNotificationReplyAccess } from '@/lib/slack/thread-access'
import { postThreadMessage } from '@/routes/slack/shared'

import type { SlackAgentThread, SlackThreadMessageRecord } from '@/lib/slack/agent-bot'
import type { SlackRuntime } from '@/routes/slack/types'

// May this reply keep driving the thread's Nuphos team? Returns false after
// telling the thread and completing the event.
export async function verifyThreadTeamAccess(args: {
  runtime: SlackRuntime
  botNuphosTeamId: string
  thread: SlackAgentThread
  slackWorkspaceId: string
  channelId: string
  threadTs: string
  eventId: string
}): Promise<boolean> {
  const { runtime, thread, channelId, threadTs, eventId } = args

  if (thread.origin === 'agent_notification') {
    // The outbound tool already authenticated and bound this exact team,
    // workspace and root message. Do not require a separate inbound channel
    // mapping just to continue it, but still fail closed if neither the
    // installation nor a channel grant still resolves to the thread's team —
    // a cross-workspace team posts through another team's installation, so
    // its notification threads authenticate via the channel mapping instead.
    // Fail closed visibly: the people replying here were mid-conversation
    // with the agent and must not be left guessing why it went quiet.
    if (args.botNuphosTeamId !== thread.teamId) {
      const grant = await getSlackChannelMapping(args.slackWorkspaceId, channelId)

      if (grant?.teamId !== thread.teamId) {
        await postThreadMessage(
          runtime,
          channelId,
          threadTs,
          "This thread's Nuphos team no longer has Slack access here, so I can't act on replies in it.",
        )
        await markSlackEvent(eventId, 'completed')

        return false
      }
    }

    return true
  }
  const mapping = await getSlackChannelMapping(args.slackWorkspaceId, channelId)

  if (!mapping || mapping.teamId !== thread.teamId) {
    await postThreadMessage(
      runtime,
      channelId,
      threadTs,
      !mapping
        ? "This channel is no longer linked to Nuphos, so I can't act on replies in this thread. A team administrator can re-link it from my DM."
        : "This channel is now linked to a different Nuphos team, so I can't continue this conversation. Mention me in a new message to start fresh.",
    )
    await markSlackEvent(eventId, 'completed')

    return false
  }

  return true
}

// Is this reply talking to the agent, or are teammates talking to each other?
// A registered thread keeps delivering every reply forever, so without this
// the agent answers people who never addressed it.
// The stored copy of the incoming text mirrors what the judge itself reads
// (its prompt clamps the incoming message to the same length).
const VERDICT_INCOMING_CHARS = 2_000

export async function isReplyAddressedToAgent(args: {
  thread: SlackAgentThread
  history: SlackThreadMessageRecord[]
  senderName: string | null
  resolvedText: string
  slackWorkspaceId: string
  channelId: string
  threadTs: string
  eventId: string
}): Promise<boolean> {
  const { thread, history } = args
  // A reply to a plan the agent left waiting for review may BE the approval.
  // Judged as chatter it is answered by nothing at all — no message, no
  // reaction — so the person who typed "可以" believes the plan is running.
  // The judge cannot infer this from the thread: approval cards are separate
  // posts, so tell it. Fail-open on a lookup failure, like the judge itself.
  const pendingDecision = await hasPlanAwaitingApprovalForConversation(thread.sessionId, {
    teamId: thread.teamId,
    userId: thread.agentUserId,
  }).catch(() => true)
  const alertThread = thread.origin === 'agent_notification'
  const judgement = await judgeThreadAddressing({
    botName: 'Nuphos',
    history,
    incoming: {
      authorName: args.senderName ?? 'A teammate',
      text: args.resolvedText || '(shared a file with no message)',
    },
    alertThread,
    pendingDecision,
    context: {
      userId: thread.agentUserId,
      sessionId: thread.sessionId,
      teamId: thread.teamId,
      slackChannelId: args.channelId,
      slackThreadTs: args.threadTs,
    },
  })
  const verdict = judgement.verdict

  logEvent('info', 'slack.agent.thread_addressing', {
    team_id: thread.teamId,
    session_id: thread.sessionId,
    slack_channel_id: args.channelId,
    slack_thread_ts: args.threadTs,
    addressed: verdict?.addressed ?? true,
    fail_open: verdict === null,
    reason: verdict?.reason,
    history_size: history.length,
    pending_decision: pendingDecision,
  })

  // Total (it logs its own failures), so awaiting cannot flip the judgement.
  await recordSlackAddressingVerdict({
    dedupeKey: `live:${args.eventId}`,
    source: 'live',
    eventId: args.eventId,
    slackWorkspaceId: args.slackWorkspaceId,
    slackChannelId: args.channelId,
    slackThreadTs: args.threadTs,
    sessionId: thread.sessionId,
    teamId: thread.teamId,
    addressed: verdict?.addressed ?? null,
    failOpen: verdict === null,
    ...(verdict?.reason ? { reason: verdict.reason } : {}),
    ...(judgement.rawText != null ? { rawOutput: judgement.rawText } : {}),
    pendingDecision,
    alertThread,
    ...(args.senderName ? { senderName: args.senderName } : {}),
    incomingText: args.resolvedText.slice(0, VERDICT_INCOMING_CHARS),
    prompt: judgement.prompt,
    modelId: judgement.modelId,
    promptVersion: THREAD_ADDRESSING_PROMPT_VERSION,
    createdAt: new Date(),
  })

  return !verdict || verdict.addressed
}

// Gate for replies in agent-notification threads: only the intended recipient
// (DM) or a current team member may continue them. Returns false after telling
// the thread and completing the event.
export async function checkNotificationReplyAccess(args: {
  runtime: SlackRuntime
  thread: SlackAgentThread
  senderNuphosUserId: string
  channelId: string
  threadTs: string
  eventId: string
}): Promise<boolean> {
  const { thread } = args
  const membership = await getTeamMembership(args.senderNuphosUserId, thread.teamId)
  const access = getAgentNotificationReplyAccess({
    slackChannelId: thread.slackChannelId,
    conversationOwnerUserId: thread.agentUserId,
    senderUserId: args.senderNuphosUserId,
    senderIsTeamMember: !!membership,
  })

  if (!access.allowed) {
    await postThreadMessage(
      args.runtime,
      args.channelId,
      args.threadTs,
      access.reason === 'dm_recipient_only'
        ? 'This incident DM can only be continued by its intended Nuphos recipient.'
        : "Your Slack identity is no longer a member of this Nuphos team, so I can't act on your reply.",
    )
    await markSlackEvent(args.eventId, 'completed')

    return false
  }

  return true
}
