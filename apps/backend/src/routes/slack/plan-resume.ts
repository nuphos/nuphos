import { turnRunner } from '@/lib/agent/turn-runner'
import { signNuphosToken } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import { getSlackUserMappingForNuphosUser } from '@/lib/slack/agent-bot'
import { postSlackMessage } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { fetchSlackUserName } from '@/lib/slack/user-profile'
import { buildMessagesForRenderedTurn } from '@/routes/slack/messages'
import { executeSlackAgentTurn } from '@/routes/slack/turn'

import type { SlackAgentThread } from '@/lib/slack/agent-bot'
import type { SlackRuntime } from '@/routes/slack/types'

// How long the approved-plan resume keeps retrying to claim the session while
// a previous turn finishes, and how often it retries. Approving right after
// the plan card lands is the COMMON case — the turn that posted the card can
// still be finalizing — so the resume must wait rather than drop execution.
const PLAN_RESUME_CLAIM_RETRY_MS = 10_000
const PLAN_RESUME_CLAIM_MAX_WAIT_MS = 10 * 60_000

// Kicks the approved plan's execution turn in the originating thread, as a
// synthetic user message from the approver. Runs detached from the interaction
// response (Slack interactions must be answered within 3 seconds).
export async function resumeApprovedPlanTurn(args: {
  thread: SlackAgentThread
  planId: string
  planTitle: string
  /** Null when the plan was approved in Nuphos by someone with no Slack
   *  identity in this workspace — the thread is then told what happened
   *  without naming anyone rather than rendering a broken mention. */
  approverSlackUserId: string | null
  approverNuphosUserId: string
}): Promise<void> {
  const botContext = await resolveSlackBotForWorkspace(args.thread.slackWorkspaceId)

  if (!botContext) return
  const runtime: SlackRuntime = {
    botToken: botContext.botToken,
    botUserId: botContext.botUserId,
  }
  let release = await turnRunner.claimAgentRunForSession(
    args.thread.agentUserId,
    args.thread.sessionId,
  )

  if (!release) {
    // A turn is still running. The approval is already persisted on the plan,
    // so execution must not be dropped: tell the thread once, then keep
    // retrying the claim for a bounded window and start as soon as it frees.
    const approvalNotice = args.approverSlackUserId
      ? `<@${args.approverSlackUserId}> approved the plan`
      : 'The plan was approved in Nuphos'

    await postSlackMessage({
      token: runtime.botToken,
      channel: args.thread.slackChannelId,
      threadTs: args.thread.slackThreadTs,
      text: `${approvalNotice} — I'm still finishing the previous turn and will start executing right after.`,
    })
    const deadline = Date.now() + PLAN_RESUME_CLAIM_MAX_WAIT_MS

    while (!release && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, PLAN_RESUME_CLAIM_RETRY_MS))
      release = await turnRunner.claimAgentRunForSession(
        args.thread.agentUserId,
        args.thread.sessionId,
      )
    }
    if (!release) {
      logEvent('warn', 'slack.plan.resume_claim_timeout', {
        plan_id: args.planId,
        session_id: args.thread.sessionId,
        waited_ms: PLAN_RESUME_CLAIM_MAX_WAIT_MS,
      })
      await postSlackMessage({
        token: runtime.botToken,
        channel: args.thread.slackChannelId,
        threadTs: args.thread.slackThreadTs,
        text: 'The previous turn is still running, so I couldn\'t start the approved plan automatically. Reply here (e.g. "run the approved plan") once it finishes and I\'ll execute it.',
      })

      return
    }
  }
  try {
    // Transcript text is human-facing in Nuphos too, so name the approver by
    // display name rather than raw mention syntax.
    const approverName = args.approverSlackUserId
      ? await fetchSlackUserName(
          runtime.botToken,
          args.thread.slackWorkspaceId,
          args.approverSlackUserId,
        )
      : null
    const approverLabel = approverName ?? `<@${String(args.approverSlackUserId)}>`
    const approvalSentence = args.approverSlackUserId
      ? `${approverLabel} approved the plan "${args.planTitle}" (planId ${args.planId}) from Slack`
      : `The plan "${args.planTitle}" (planId ${args.planId}) was approved in Nuphos, not in this thread`
    const renderedText = [
      `${approvalSentence}; its status is now approved.`,
      "Begin executing the approved plan now. Load the `plan` skill if you have not already loaded it this conversation, keep the plan's command statuses in sync via the plan REST API as you work, and keep this Slack thread posted.",
    ].join('\n')
    const messages = await buildMessagesForRenderedTurn({
      sessionId: args.thread.sessionId,
      userId: args.thread.agentUserId,
      teamId: args.thread.teamId,
      messageId: `slack-plan-approve-${args.planId}`,
      turnKind: 'plan-approval',
      renderedText,
    })

    await executeSlackAgentTurn({
      runtime,
      eventId: null,
      sessionId: args.thread.sessionId,
      agentUserId: args.thread.agentUserId,
      actorUserId: args.approverNuphosUserId,
      teamId: args.thread.teamId,
      channel: args.thread.slackChannelId,
      threadTs: args.thread.slackThreadTs,
      nuphosToken: signNuphosToken(args.approverNuphosUserId, 60 * 60 * 8),
      messages,
      firstMessage: `Plan approved: ${args.planTitle}`,
    })
  } finally {
    release()
  }
}

/**
 * A plan approved in the Nuphos app rather than from its own Slack card — see
 * lib/agent/plan-slack-resume.ts for why the thread has to be the one to run it.
 *
 * Called detached from the approving HTTP request: it posts to Slack and starts
 * a turn, neither of which the approval should wait on or be failed by.
 */
export async function resumeApprovedPlanTurnFromNuphos(args: {
  thread: SlackAgentThread
  planId: string
  planTitle: string
  approverNuphosUserId: string
}): Promise<void> {
  // A turn already running for this session means the approval came from inside
  // it — the agent PATCHing the plan it is working on (the plan skill forbids
  // it, but the REST path allows it). It is already in the thread and can start
  // executing where it is; kicking would announce an approval nobody made and
  // then run the plan a SECOND time once the claim frees. The button path waits
  // for the claim instead because there the approval provably came from outside.
  if (
    await turnRunner.hasActiveAgentRunForSession(args.thread.agentUserId, args.thread.sessionId)
  ) {
    logEvent('info', 'slack.plan.resume_from_nuphos_skipped', {
      plan_id: args.planId,
      session_id: args.thread.sessionId,
      team_id: args.thread.teamId,
      reason: 'turn_already_running',
    })

    return
  }
  // Name the approver in Slack terms when they have an identity in this
  // workspace; best-effort, the resume proceeds either way.
  const mapping = await getSlackUserMappingForNuphosUser(
    args.thread.slackWorkspaceId,
    args.thread.teamId,
    args.approverNuphosUserId,
  ).catch(() => null)

  logEvent('info', 'slack.plan.resume_from_nuphos', {
    plan_id: args.planId,
    session_id: args.thread.sessionId,
    team_id: args.thread.teamId,
    slack_channel_id: args.thread.slackChannelId,
    approver_nuphos_user_id: args.approverNuphosUserId,
    approver_slack_user_id: mapping?.slackUserId,
  })
  await resumeApprovedPlanTurn({
    thread: args.thread,
    planId: args.planId,
    planTitle: args.planTitle,
    approverSlackUserId: mapping?.slackUserId ?? null,
    approverNuphosUserId: args.approverNuphosUserId,
  })
}
