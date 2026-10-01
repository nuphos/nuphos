import { journalPlanDecision } from '@/lib/agent/journal-capture'
import { getPlan, recordPlanApproval } from '@/lib/agent/plans'
import { getTeamMembership } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'
import { getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { isPlanReadyForApproval } from '@/routes/agent'
import { resolveSlackUserMapping } from '@/routes/slack/identity'
import { createInteractionRepliers } from '@/routes/slack/interaction-replies'
import { resumeApprovedPlanTurn } from '@/routes/slack/plan-resume'

// Approve button pressed on a plan review card. Approves the plan as the
// mapped Nuphos user (same gates as the in-app approval), kicks the execution
// turn asynchronously, and replaces the card so the button disappears.
//
// Runs DETACHED from the interaction HTTP response: the approval does real work
// (auth checks, a plan state transition, resume kickoff) that routinely exceeds
// Slack's 3-second interaction-ack deadline. Every user-facing reply — the card
// swap and any error — is delivered through `response_url` (valid ~30 min)
// instead of the direct response body, which Slack silently drops once the 3s
// window closes. That dropped-body path is exactly why the Approve button used
// to linger and the plan's task_cards spun on `pending` forever even though
// execution had already started.
export async function handlePlanApproveInteraction(args: {
  slackWorkspaceId: string
  slackUserId: string
  value: string
  responseUrl?: string
  // Where the click happened, so rejections can be delivered as ephemerals
  // INSIDE that thread — a response_url ephemeral always renders at the
  // channel root, which reads as a stray bot message out of context.
  channelId?: string
  threadTs?: string
}): Promise<void> {
  const repliers = createInteractionRepliers({
    slackWorkspaceId: args.slackWorkspaceId,
    slackUserId: args.slackUserId,
    responseUrl: args.responseUrl,
    channelId: args.channelId,
    threadTs: args.threadTs,
    events: {
      noResponseUrl: 'slack.plan.approve.no_response_url',
      responseUrlError: 'slack.plan.approve.response_url_error',
      rejected: 'slack.plan.approve_rejected',
      ephemeralError: 'slack.plan.approve.ephemeral_error',
    },
  })
  const { reply, reject, ephemeral } = repliers

  let parsed: { planId?: string; sessionId?: string; title?: string }

  try {
    parsed = JSON.parse(args.value) as { planId?: string; sessionId?: string; title?: string }
  } catch {
    await reject(
      'malformed_value',
      'This approval button is malformed — open the plan in Nuphos instead.',
    )

    return
  }
  const { planId, sessionId } = parsed

  if (!planId || !sessionId) {
    await reject(
      'malformed_value',
      'This approval button is malformed — open the plan in Nuphos instead.',
    )

    return
  }

  const botContext = await resolveSlackBotForWorkspace(args.slackWorkspaceId)

  if (!botContext) {
    await reject(
      'workspace_not_installed',
      'Nuphos is not fully installed for this Slack workspace.',
      {
        plan_id: planId,
        session_id: sessionId,
      },
    )

    return
  }
  repliers.setBotToken(botContext.botToken)
  // The thread is the scoping root and is resolved FIRST: a channel-mapped
  // channel can belong to a different Nuphos team than the workspace's OAuth
  // binding, and the plan, the user mappings, and the membership gate all live
  // in the THREAD's team. Scoping any of them to botContext.nuphosTeamId
  // silently broke every cross-team approval (plans #88/#89). The button
  // payload is client-controlled, so requiring the thread to belong to this
  // Slack workspace is also the authZ check.
  const thread = await getSlackAgentThreadBySessionId(sessionId)

  if (!thread || thread.slackWorkspaceId !== args.slackWorkspaceId) {
    await reject(
      'thread_unresolved',
      "Approved plans resume in their original Slack thread, but I couldn't match this one — open the plan in Nuphos to approve and run it there.",
      { plan_id: planId, session_id: sessionId, thread_found: Boolean(thread) },
    )

    return
  }
  const teamId = thread.teamId
  const { mapping } = await resolveSlackUserMapping(
    args.slackWorkspaceId,
    teamId,
    args.slackUserId,
    botContext.botToken,
  )

  if (!mapping) {
    await reject(
      'user_not_linked',
      'Your Slack account is not linked to Nuphos yet. Link it in Nuphos → Settings → Slack, then press Approve again.',
      { plan_id: planId, session_id: sessionId, team_id: teamId },
    )

    return
  }
  // A stored mapping outlives team membership: if the mapped Nuphos user has
  // since been removed from the team, the stale mapping must not still let them
  // approve. The in-app approval endpoint enforces this via team-scoped auth;
  // mirror that gate here rather than trusting the mapping alone.
  const membership = await getTeamMembership(mapping.nuphosUserId, teamId)

  if (!membership) {
    await reject(
      'not_team_member',
      "Your Nuphos account is no longer a member of this team, so you can't approve this plan.",
      {
        plan_id: planId,
        session_id: sessionId,
        team_id: teamId,
        nuphos_user_id: mapping.nuphosUserId,
      },
    )

    return
  }
  const plan = await getPlan(planId, { teamId, userId: mapping.nuphosUserId })

  if (!plan) {
    await reject('plan_not_found', 'Plan not found — it may have been deleted.', {
      plan_id: planId,
      session_id: sessionId,
      team_id: teamId,
    })

    return
  }
  if (plan.status !== 'proposed') {
    await reject('plan_not_proposed', `This plan is already ${plan.status}.`, {
      plan_id: planId,
      session_id: sessionId,
      team_id: teamId,
      plan_status: plan.status,
    })

    return
  }
  if (!isPlanReadyForApproval(plan)) {
    await reject(
      'plan_incomplete',
      'This plan is missing required sections (steps, cost, or risk) and cannot be approved yet — open it in Nuphos.',
      { plan_id: planId, session_id: sessionId, team_id: teamId },
    )

    return
  }

  // Same quorum path as the in-app endpoint: the mapped human contributes one
  // vote, and only the request that completes the policy snapshot may resume
  // execution. A double click is deduplicated by user and policy version.
  const approval = await recordPlanApproval(
    planId,
    { teamId, userId: mapping.nuphosUserId },
    mapping.nuphosUserId,
  )
  const updated = approval.plan

  if (!updated) {
    await reject(
      'approval_race_lost',
      'This plan was just approved — no need to approve it again.',
      {
        plan_id: planId,
        session_id: sessionId,
        team_id: teamId,
      },
    )

    return
  }
  if (!approval.thresholdReached) {
    if (!approval.recorded) {
      await ephemeral('Your approval is already recorded for this plan.')

      return
    }
    const remaining = Math.max(
      0,
      Number(!updated.approvalProgress.requesterApproved) +
        updated.approvalProgress.minimumOtherApprovals -
        updated.approvalProgress.otherApprovals,
    )

    await ephemeral(
      `Approval recorded. ${String(remaining)} required approval${remaining === 1 ? '' : 's'} remaining before execution can start.`,
    )

    return
  }
  // Same trust-root record as the in-app approval: a Slack "Approve & run" is a
  // production approval path and must land on the chain.
  await journalPlanDecision(
    updated,
    { userId: mapping.nuphosUserId, teamId: teamId ?? null },
    'approved',
  )
  logEvent('info', 'slack.plan.approved', {
    plan_id: planId,
    session_id: sessionId,
    team_id: teamId,
    slack_workspace_id: args.slackWorkspaceId,
    slack_user_id: args.slackUserId,
    nuphos_user_id: mapping.nuphosUserId,
  })

  const title = updated.title || parsed.title || 'plan'

  void resumeApprovedPlanTurn({
    thread,
    planId,
    planTitle: title,
    approverSlackUserId: args.slackUserId,
    approverNuphosUserId: mapping.nuphosUserId,
  }).catch((err: unknown) => {
    logError('slack.plan.resume.error', err, { plan_id: planId, session_id: sessionId })
  })

  // replace_original swaps the card for everyone in the thread (so the
  // Approve & run button disappears and the pending task_cards stop spinning
  // the moment the first click lands) — name the approver rather than saying
  // "you", which would read as a false first-person claim to every other member.
  await reply({
    replace_original: true,
    text: `Plan approved: ${title}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `📋 *${escapeSlackMrkdwn(title)}*` } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `✅ Approved by <@${args.slackUserId}> — Nuphos is starting execution in this thread.`,
          },
        ],
      },
    ],
  })
}
