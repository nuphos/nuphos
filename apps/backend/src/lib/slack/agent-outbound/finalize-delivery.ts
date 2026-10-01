import { logEvent } from '@/lib/observability'

import type {
  SlackOutboundContext,
  SlackOutboundDependencies,
} from '@/lib/slack/agent-outbound/types'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { SlackIncidentReservation } from '@/lib/slack/incident-notifications'

// Server-written, so "you can reply here" reads the same under every report.
// Left to the model it would be phrased differently each time — and a reader
// cannot tell a repliable message from a dead one by how it happens to be worded.
const REPLY_THREAD_INVITATION = 'Reply in this thread if you want me to dig into any of it.'

// The addressing judge reads a thread's rolling transcript, and inbound routes
// only record what humans send. An outbound post into a bound thread must be
// recorded here or the judge never sees what the bot itself said — and then
// misreads follow-up questions about it as teammate chatter. Best-effort: the
// message is already delivered, so a failed append is logged, never raised.
async function appendToBoundThreadTranscript(input: {
  dependencies: SlackOutboundDependencies
  teamId: string
  slackWorkspaceId: string
  slackChannelId: string
  slackThreadTs: string
  ts: string
  text: string
}): Promise<void> {
  try {
    await input.dependencies.appendThreadMessage(
      {
        slackWorkspaceId: input.slackWorkspaceId,
        slackChannelId: input.slackChannelId,
        slackThreadTs: input.slackThreadTs,
      },
      { ts: input.ts, authorName: 'Nuphos', text: input.text, fromBot: true },
    )
  } catch (err) {
    logEvent('warn', 'slack.outbound.transcript_append_failed', {
      team_id: input.teamId,
      slack_workspace_id: input.slackWorkspaceId,
      slack_channel_id: input.slackChannelId,
      slack_thread_ts: input.slackThreadTs,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function finalizeSlackPostDelivery(input: {
  dependencies: SlackOutboundDependencies
  userId: string
  teamId: string
  conversationId: string
  triggerId?: string
  destinationType: SlackOutboundDestination['type']
  label: string
  text: string
  sendToken: string
  sendWorkspaceId: string
  channelId: string
  responseChannel: string
  messageTs: string
  threadTs: string | undefined
  selfMapping: { slackUserId: string } | null
  bindCurrentConversation: boolean
  forkThread: { text: string } | undefined
  incidentReservation: SlackIncidentReservation | undefined
}): Promise<Awaited<ReturnType<SlackOutboundContext['post']>>> {
  const { dependencies, teamId, userId, text, sendWorkspaceId, sendToken, channelId } = input
  const { messageTs, responseChannel, threadTs, selfMapping, bindCurrentConversation } = input

  if (input.incidentReservation) {
    try {
      await dependencies.recordIncidentDelivery(input.incidentReservation, {
        rootThreadTs: threadTs ?? messageTs,
        agentUserId: userId,
        createdBySlackUserId: selfMapping?.slackUserId,
      })
    } catch (err) {
      // Continue into binding/completion: either operation can still
      // leave durable evidence for lease recovery. Never abort a
      // reservation after Slack has accepted the message.
      logEvent('warn', 'slack.incident_notification.delivery_record_failed', {
        team_id: teamId,
        trigger_id: input.triggerId!,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // A threadTs here means this delivery went into an existing bound thread
  // (a root created now is seeded by bindThread's rootText instead).
  if (threadTs) {
    await appendToBoundThreadTranscript({
      dependencies,
      teamId,
      slackWorkspaceId: sendWorkspaceId,
      slackChannelId: responseChannel,
      slackThreadTs: threadTs,
      ts: messageTs,
      text,
    })
  }

  // Replies must reach the run that is working the alert right now, so a
  // thread the model chose to continue is handed over to this run the
  // same way a fresh root is bound to it. Never throw after Slack
  // accepted the message: a failed handover leaves replies on the
  // previous run, which is recoverable.
  if (bindCurrentConversation && threadTs) {
    try {
      await dependencies.rebindThreadSession({
        slackWorkspaceId: sendWorkspaceId,
        slackChannelId: responseChannel,
        slackThreadTs: threadTs,
        sessionId: input.conversationId,
        teamId,
        agentUserId: userId,
      })
    } catch (err) {
      logEvent('warn', 'slack.incident_notification.thread_handover_failed', {
        team_id: teamId,
        slack_thread_ts: threadTs,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (bindCurrentConversation && !threadTs) {
    await dependencies.bindThread({
      slackWorkspaceId: sendWorkspaceId,
      slackChannelId: responseChannel,
      slackThreadTs: messageTs,
      teamId,
      agentUserId: userId,
      sessionId: input.conversationId,
      createdBySlackUserId: selfMapping?.slackUserId,
      rootText: text,
    })
  }

  // Open the thread the root advertises, and give it a conversation of its
  // own rather than resuming this run: whoever replies is asking about the
  // message in front of them, not continuing the batch that produced it.
  // A fresh session is also why this can bind at all — sessionId is
  // uniquely indexed, and this run may already own a thread elsewhere.
  let forkResult: { opened: boolean; sessionId?: string; error?: string } | undefined

  if (input.forkThread && !threadTs) {
    const forkSessionId = dependencies.newSessionId()

    try {
      const replyText = `${input.forkThread.text.trim()}\n\n${REPLY_THREAD_INVITATION}`
      const replyResponse = await dependencies.postMessage({
        token: sendToken,
        channel: channelId,
        text: replyText,
        threadTs: messageTs,
      })

      await dependencies.bindThread({
        slackWorkspaceId: sendWorkspaceId,
        slackChannelId: responseChannel,
        slackThreadTs: messageTs,
        teamId,
        agentUserId: userId,
        sessionId: forkSessionId,
        createdBySlackUserId: selfMapping?.slackUserId,
        rootText: text,
        // What the thread is about, in full. recentMessages clips each
        // entry, which cannot carry a report someone is about to ask a
        // question about.
        notificationContext: `${text}\n\n${replyText}`,
      })
      // bindThread seeded only the root; the reply itself lives in the thread
      // the judge will read, so record it under its real Slack ts.
      if (replyResponse.ts) {
        await appendToBoundThreadTranscript({
          dependencies,
          teamId,
          slackWorkspaceId: sendWorkspaceId,
          slackChannelId: responseChannel,
          slackThreadTs: messageTs,
          ts: replyResponse.ts,
          text: replyText,
        })
      }
      forkResult = { opened: true, sessionId: forkSessionId }
    } catch (err) {
      // The report is already in the channel. A thread that failed to open
      // is worth reporting, never worth turning a delivered message into a
      // failure the model will try to "fix" by posting again.
      const error = err instanceof Error ? err.message : String(err)

      logEvent('warn', 'slack.outbound.reply_thread_failed', {
        team_id: teamId,
        slack_workspace_id: sendWorkspaceId,
        slack_channel_id: responseChannel,
        error,
      })
      forkResult = { opened: false, error }
    }
  }

  if (input.incidentReservation) {
    const delivery = threadTs ? 'thread_update' : 'root'

    await dependencies.completeIncident(input.incidentReservation, {
      threadTs: threadTs ?? messageTs,
      text,
      startedNewThread: !threadTs,
    })
    logEvent('info', 'slack.incident_notification.delivered', {
      team_id: teamId,
      trigger_id: input.triggerId!,
      slack_workspace_id: sendWorkspaceId,
      slack_channel_id: responseChannel,
      delivery,
    })
  }

  return {
    ok: true,
    destination: { type: input.destinationType, channelId: responseChannel, label: input.label },
    delivery: threadTs ? 'thread_update' : 'root',
    messageTs,
    rootThreadTs: threadTs ?? messageTs,
    threadBound: bindCurrentConversation || forkResult?.opened === true,
    ...(forkResult ? { replyThread: forkResult } : {}),
  }
}
