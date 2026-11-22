import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'
import { upsertSlackReplyFeedback } from '@/lib/slack/agent-bot'
import { canVerifySlackRequests, verifySlackSignature } from '@/lib/slack/api'
import { HOME_REFRESH_ACTION } from '@/lib/slack/home-tab'
import { publishHomeTabForUser } from '@/routes/slack/home'
import {
  PERMISSION_APPROVE_ACTION,
  PERMISSION_REJECT_ACTION,
} from '@/routes/slack/permission-cards'
import { handlePermissionGrantInteraction } from '@/routes/slack/permission-decide'
import { PICKUP_SESSION_ACTION, handlePickupSessionInteraction } from '@/routes/slack/pickup'
import {
  TOOL_APPROVAL_ALLOW_ACTION,
  TOOL_APPROVAL_REJECT_ACTION,
} from '@/routes/slack/tool-approval-cards'
import { handleToolApprovalInteraction } from '@/routes/slack/tool-approval-decide'

import type { AuthVariables } from '@/middleware/auth'
import type { SlackInteractionPayload } from '@/routes/slack/types'
import type { Hono } from 'hono'

// 👍/👎 feedback buttons are no longer attached to new replies, but messages
// posted before their removal still carry live buttons — the /interactions
// handler keeps answering these action_ids so old cards don't dead-end.
const FEEDBACK_UP_ACTION = 'nuphos_feedback_up'
const FEEDBACK_DOWN_ACTION = 'nuphos_feedback_down'
// Same for the Approve button on retired Plan cards (#2316).
const PLAN_APPROVE_ACTION = 'nuphos_plan_approve'

// 👍/👎 pressed on a finalized agent reply. Recorded per (message, user) —
// pressing the other button later flips the vote. Responds ephemerally so the
// conversation itself stays clean.
async function handleFeedbackInteraction(args: {
  slackWorkspaceId: string
  slackUserId: string
  payload: SlackInteractionPayload
  verdict: 'up' | 'down'
  sessionId?: string
}): Promise<Record<string, unknown>> {
  const channelId = args.payload.channel?.id
  const messageTs = args.payload.message?.ts

  if (channelId && messageTs) {
    try {
      await upsertSlackReplyFeedback({
        slackWorkspaceId: args.slackWorkspaceId,
        slackChannelId: channelId,
        messageTs,
        slackUserId: args.slackUserId,
        sessionId: args.sessionId,
        verdict: args.verdict,
      })
    } catch (err) {
      logError('slack.feedback.persist_error', err, {
        slack_workspace_id: args.slackWorkspaceId,
        slack_channel_id: channelId,
        slack_message_ts: messageTs,
      })
    }
  }
  logEvent('info', 'slack.feedback.received', {
    slack_workspace_id: args.slackWorkspaceId,
    slack_user_id: args.slackUserId,
    verdict: args.verdict,
    session_id: args.sessionId,
  })

  return {
    response_type: 'ephemeral',
    replace_original: false,
    text:
      args.verdict === 'up'
        ? 'Thanks for the feedback!'
        : "Got it, thanks — we'll use this to improve answer quality.",
  }
}

async function handleSlackInteraction(
  payload: SlackInteractionPayload,
): Promise<Record<string, unknown> | null> {
  // Log everything we don't handle: Slack routes other interaction payloads
  // here too (message actions, unknown button clicks, …), and a silent 200 makes
  // them invisible when reconstructing an incident from telemetry.
  if (payload.type !== 'block_actions') {
    logEvent('info', 'slack.interaction.unhandled', {
      interaction_type: payload.type ?? 'unknown',
      slack_workspace_id: payload.team?.id,
    })

    return null
  }
  const slackWorkspaceId = payload.team?.id
  const slackUserId = payload.user?.id
  const action = payload.actions?.[0]

  if (!slackWorkspaceId || !slackUserId || !action?.action_id) return null

  if (action.action_id === FEEDBACK_UP_ACTION || action.action_id === FEEDBACK_DOWN_ACTION) {
    return await handleFeedbackInteraction({
      slackWorkspaceId,
      slackUserId,
      payload,
      verdict: action.action_id === FEEDBACK_UP_ACTION ? 'up' : 'down',
      sessionId: action.value || undefined,
    })
  }

  if (action.action_id === PLAN_APPROVE_ACTION) {
    return {
      response_type: 'ephemeral',
      replace_original: false,
      text: 'Plans are retired. Agents now ask for approval with a decision in the Nuphos Inbox.',
    }
  }

  if (
    action.action_id === PERMISSION_APPROVE_ACTION ||
    action.action_id === PERMISSION_REJECT_ACTION
  ) {
    // Ack within Slack's 3-second deadline, then decide asynchronously:
    // applying IAM changes across a provider API cannot fit in it.
    void handlePermissionGrantInteraction({
      slackWorkspaceId,
      slackUserId,
      decision: action.action_id === PERMISSION_APPROVE_ACTION ? 'approve' : 'reject',
      value: action.value ?? '',
      responseUrl: payload.response_url,
      channelId: payload.channel?.id,
      threadTs: payload.message?.thread_ts ?? payload.message?.ts,
    }).catch((err: unknown) => {
      logError('slack.permission.decide.error', err, {
        slack_workspace_id: slackWorkspaceId,
        slack_user_id: slackUserId,
      })
    })

    return null
  }

  if (
    action.action_id === TOOL_APPROVAL_ALLOW_ACTION ||
    action.action_id === TOOL_APPROVAL_REJECT_ACTION
  ) {
    void handleToolApprovalInteraction({
      slackWorkspaceId,
      slackUserId,
      decision: action.action_id === TOOL_APPROVAL_ALLOW_ACTION ? 'allow' : 'reject',
      value: action.value ?? '',
      responseUrl: payload.response_url,
      channelId: payload.channel?.id,
      threadTs: payload.message?.thread_ts ?? payload.message?.ts,
    }).catch((err: unknown) => {
      logError('slack.tool_approval.decide.error', err, {
        slack_workspace_id: slackWorkspaceId,
        slack_user_id: slackUserId,
      })
    })

    return null
  }

  if (action.action_id === PICKUP_SESSION_ACTION) {
    // Detached like the plan/permission cards: the bind does Slack + Mongo
    // round-trips that cannot fit Slack's 3-second ack. The handler reports
    // back through response_url, replacing the ephemeral picker.
    if (!action.value || !payload.response_url) return null
    void handlePickupSessionInteraction({
      slackWorkspaceId,
      slackUserId,
      sessionId: action.value,
      responseUrl: payload.response_url,
    }).catch((err: unknown) => {
      logError('slack.session_pickup.error', err, {
        slack_workspace_id: slackWorkspaceId,
        slack_user_id: slackUserId,
      })
    })

    return null
  }

  if (action.action_id === HOME_REFRESH_ACTION) {
    // Interactions must be acked within 3 seconds; publish detached. View
    // actions ignore the response body anyway.
    void publishHomeTabForUser({ slackWorkspaceId, slackUserId }).catch((err: unknown) => {
      logError('slack.home.refresh.error', err, {
        slack_workspace_id: slackWorkspaceId,
        slack_user_id: slackUserId,
      })
    })

    return null
  }

  logEvent('info', 'slack.interaction.unhandled', {
    interaction_type: payload.type,
    action_id: action.action_id,
    slack_workspace_id: slackWorkspaceId,
  })

  return null
}

export function registerSlackInteractionRoutes(
  slackRoutes: Hono<{ Variables: AuthVariables }>,
): void {
  slackRoutes.post('/interactions', async (c) => {
    if (!canVerifySlackRequests()) {
      throw new AppError(503, 'slack_not_configured', 'SLACK_SIGNING_SECRET is not configured')
    }

    const rawBody = await c.req.text()
    const valid = verifySlackSignature(
      rawBody,
      c.req.header('X-Slack-Request-Timestamp'),
      c.req.header('X-Slack-Signature'),
    )

    if (!valid) throw new AppError(401, 'invalid_signature', 'Invalid Slack signature')

    const params = new URLSearchParams(rawBody)
    const payloadRaw = params.get('payload')

    if (!payloadRaw) {
      throw new AppError(400, 'invalid_request', 'Missing Slack interaction payload')
    }

    const payload = JSON.parse(payloadRaw) as SlackInteractionPayload
    const response = await handleSlackInteraction(payload)

    if (response) {
      return c.json(response)
    }

    return c.body(null, 200)
  })
}
