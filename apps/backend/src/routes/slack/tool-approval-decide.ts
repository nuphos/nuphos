import {
  findPreviewWaitByRef,
  resolvePreviewDecision,
} from '@/lib/claude-code-preview/decision-waiter'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import { getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { createInteractionRepliers } from '@/routes/slack/interaction-replies'
import { resolveSlackUserMapping } from '@/routes/slack/identity'

export async function handleToolApprovalInteraction(args: {
  slackWorkspaceId: string
  slackUserId: string
  decision: 'allow' | 'reject'
  value: string
  responseUrl?: string
  channelId?: string
  threadTs?: string
}): Promise<void> {
  const repliers = createInteractionRepliers({
    slackWorkspaceId: args.slackWorkspaceId,
    slackUserId: args.slackUserId,
    responseUrl: args.responseUrl,
    channelId: args.channelId,
    threadTs: args.threadTs,
    rejectLogExtra: { decision: args.decision },
    events: {
      noResponseUrl: 'slack.tool_approval.no_response_url',
      responseUrlError: 'slack.tool_approval.response_url_error',
      rejected: 'slack.tool_approval.decision_rejected',
      ephemeralError: 'slack.tool_approval.ephemeral_error',
    },
  })
  let parsed: { sessionId?: string; toolCallId?: string }

  try {
    parsed = JSON.parse(args.value) as { sessionId?: string; toolCallId?: string }
  } catch {
    await repliers.reject('malformed_value', 'This tool approval button is malformed.')

    return
  }
  const { sessionId, toolCallId } = parsed

  if (!sessionId || !toolCallId) {
    await repliers.reject('malformed_value', 'This tool approval button is malformed.')

    return
  }
  const botContext = await resolveSlackBotForWorkspace(args.slackWorkspaceId)

  if (!botContext) {
    await repliers.reject('workspace_not_installed', 'Nuphos is not fully installed here.')

    return
  }
  repliers.setBotToken(botContext.botToken)
  const thread = await getSlackAgentThreadBySessionId(sessionId)

  if (!thread || thread.slackWorkspaceId !== args.slackWorkspaceId) {
    await repliers.reject(
      'thread_unresolved',
      'This tool request no longer belongs to this thread.',
    )

    return
  }
  const wait = await findPreviewWaitByRef('agent-permission', toolCallId)

  if (!wait || wait.sessionId !== sessionId) {
    await repliers.reject(
      'request_expired',
      'This tool request has expired or was already decided.',
    )

    return
  }
  const { mapping } = await resolveSlackUserMapping(
    args.slackWorkspaceId,
    thread.teamId,
    args.slackUserId,
    botContext.botToken,
  )

  if (!mapping) {
    await repliers.reject(
      'user_not_linked',
      'Link this Slack account to Nuphos before deciding tool requests.',
    )

    return
  }
  if (mapping.nuphosUserId !== wait.userId) {
    await repliers.reject(
      'wrong_principal',
      'Only the person whose credentials this turn is using can decide this tool request.',
      { expected_nuphos_user_id: wait.userId, actual_nuphos_user_id: mapping.nuphosUserId },
    )

    return
  }
  if (!(await getTeamMembership(mapping.nuphosUserId, thread.teamId))) {
    await repliers.reject('not_team_member', 'You are no longer a member of this Nuphos team.')

    return
  }
  const decided = await resolvePreviewDecision({
    userId: wait.userId,
    sessionId: wait.sessionId,
    waitId: wait.waitId,
    payload: { decision: args.decision === 'allow' ? 'approved' : 'rejected' },
  })

  if (!decided) {
    await repliers.reject('decision_race_lost', 'This tool request was already decided.')

    return
  }
  logEvent('info', 'slack.tool_approval.decided', {
    decision: args.decision,
    tool_call_id: toolCallId,
    session_id: sessionId,
    team_id: thread.teamId,
    slack_workspace_id: args.slackWorkspaceId,
    slack_user_id: args.slackUserId,
    nuphos_user_id: mapping.nuphosUserId,
  })
  const allowed = args.decision === 'allow'

  await repliers.reply({
    replace_original: true,
    text: allowed ? 'Tool approved once.' : 'Tool request rejected.',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${allowed ? '✅ Allowed once' : '⛔ Rejected'} by <@${escapeSlackMrkdwn(args.slackUserId)}>`,
        },
      },
    ],
  })
}
