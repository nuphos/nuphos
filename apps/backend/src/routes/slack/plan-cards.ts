import { getPlan } from '@/lib/agent/plans'
import { logError, logEvent } from '@/lib/observability'
import { postSlackMessage } from '@/lib/slack/api'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { isPlanReadyForApproval } from '@/lib/agent/plan-readiness'
import { truncatePlain } from '@/routes/slack/shared'

import type { PlanStep } from '@/lib/agent/plans'
import type { SlackCreatedPlan } from '@/lib/agent/tools-skilled/types'
import type { SlackRuntime } from '@/routes/slack/types'

export function slackPlanUrl(teamId: string | undefined, planId: string): string | null {
  return teamId ? `https://nuphos.ai/teams/${teamId}/plans/${planId}` : null
}

export function slackPlanLink(teamId: string | undefined, plan: SlackCreatedPlan): string {
  const label = plan.title.replace(/[<>|]/g, '').trim() || 'plan'
  const url = slackPlanUrl(teamId, plan.planId)

  return url ? `<${url}|${label}>` : label
}

// The Approve button on plan review cards (block_actions in /interactions).
export const PLAN_APPROVE_ACTION = 'nuphos_plan_approve'

// task_card titles are plain text; Slack caps them tightly (same 256-char
// ceiling as Block Kit text fields).
const PLAN_TASK_TITLE_LIMIT = 200
const PLAN_TASK_DETAILS_LIMIT = 500
// A plan block's tasks render inside one block, but keep the card scannable —
// a truncation notice replaces the tail of very long plans.
const PLAN_BLOCK_MAX_TASKS = 25

// task_card details/output must each be a single rich_text entity.
function planRichText(text: string): unknown {
  return {
    type: 'rich_text',
    elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }],
  }
}

// Block Kit `plan` block: the proposed plan's steps as pending `task_card`s,
// so the thread shows exactly what would run before anyone hits Approve.
function buildPlanStepsBlock(title: string, steps: PlanStep[]): unknown {
  const shown = steps.slice(0, PLAN_BLOCK_MAX_TASKS)
  const tasks = shown.map((step, idx) => ({
    type: 'task_card',
    task_id: `step-${String(idx + 1)}`,
    title: truncatePlain(step.title, PLAN_TASK_TITLE_LIMIT),
    status: 'pending',
    ...(step.description
      ? { details: planRichText(truncatePlain(step.description, PLAN_TASK_DETAILS_LIMIT)) }
      : {}),
  }))

  if (steps.length > shown.length) {
    tasks.push({
      type: 'task_card',
      task_id: 'steps-truncated',
      title: `…and ${String(steps.length - shown.length)} more steps — open the plan in Nuphos for the full list`,
      status: 'pending',
    })
  }

  return { type: 'plan', title: truncatePlain(title, PLAN_TASK_TITLE_LIMIT), tasks }
}

function buildPlanApprovalBlocks(args: {
  planId: string
  sessionId: string
  teamId: string
  title: string
  overview?: string
  // Rendered as a Block Kit `plan` block of pending `task_card`s. Omitted on
  // the fallback rebuild when Slack rejects the blocks (workspaces whose app
  // predates the Agents & AI Apps block types).
  steps?: PlanStep[]
  // False when the plan is missing required sections and can only be reviewed
  // in Nuphos; the card then carries no Approve button.
  approvable: boolean
}): unknown[] {
  const url = slackPlanUrl(args.teamId, args.planId)
  const overviewLine = args.overview ? `\n${escapeSlackMrkdwn(args.overview)}` : ''
  const heading = `📋 *${escapeSlackMrkdwn(args.title)}*${overviewLine}`
  const buttons: unknown[] = []

  if (url) {
    buttons.push({
      type: 'button',
      text: { type: 'plain_text', text: 'View plan', emoji: true },
      url,
    })
  }
  if (args.approvable) {
    buttons.push({
      type: 'button',
      style: 'primary',
      action_id: PLAN_APPROVE_ACTION,
      text: { type: 'plain_text', text: 'Approve & run', emoji: true },
      // Carried back on the block_actions payload; keep it small (Slack caps
      // button values at 2000 chars).
      value: JSON.stringify({
        planId: args.planId,
        sessionId: args.sessionId,
        title: args.title.slice(0, 120),
      }),
      confirm: {
        title: { type: 'plain_text', text: 'Approve this plan?' },
        text: {
          type: 'mrkdwn',
          text: `Nuphos will start executing *${escapeSlackMrkdwn(args.title.slice(0, 120))}* right away.`,
        },
        confirm: { type: 'plain_text', text: 'Approve' },
        deny: { type: 'plain_text', text: 'Cancel' },
      },
    })
  }

  return [
    { type: 'section', text: { type: 'mrkdwn', text: heading } },
    ...(args.steps?.length ? [buildPlanStepsBlock(args.title, args.steps)] : []),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: args.approvable
            ? 'Waiting for review — approve it here, or open it in Nuphos first.'
            : 'Waiting for review — it is missing required sections, open it in Nuphos.',
        },
      ],
    },
    ...(buttons.length ? [{ type: 'actions', elements: buttons }] : []),
  ]
}

export type PostedPlanCard = { planId: string; title: string }

// One review/approve card per plan this turn left in `proposed`, posted as its
// own thread message after the reply content. Best-effort: a failed
// card must not fail the turn (the reply text already links the plan).
export async function postPlanApprovalCards(args: {
  runtime: SlackRuntime
  channel: string
  threadTs: string
  teamId: string
  agentUserId: string
  sessionId: string
  plans: SlackCreatedPlan[]
}): Promise<PostedPlanCard[]> {
  const posted: PostedPlanCard[] = []

  for (const created of args.plans) {
    try {
      const plan = await getPlan(created.planId, { teamId: args.teamId, userId: args.agentUserId })

      if (!plan || plan.status !== 'proposed') continue
      const cardArgs = {
        planId: created.planId,
        sessionId: args.sessionId,
        teamId: args.teamId,
        title: plan.title || created.title,
        overview: plan.overview ?? created.overview,
        approvable: isPlanReadyForApproval(plan),
      }
      const post = (blocks: unknown[]) =>
        postSlackMessage({
          token: args.runtime.botToken,
          channel: args.channel,
          threadTs: args.threadTs,
          text: `Plan waiting for review: ${slackPlanLink(args.teamId, created)}`,
          blocks,
        })

      try {
        await post(buildPlanApprovalBlocks({ ...cardArgs, steps: plan.steps }))
      } catch (err) {
        // The `plan` block is the newest Block Kit surface; apps predating the
        // AI block types reject it as invalid_blocks. Only that error warrants
        // reposting without the plan block — anything else (network, auth,
        // rate limit) would fail the retry too, so let the outer catch log it.
        const message = err instanceof Error ? err.message : String(err)

        if (!plan.steps.length || !message.includes('invalid_blocks')) throw err
        logEvent('warn', 'slack.plan.approval_card.plan_block_rejected', {
          plan_id: created.planId,
          slack_channel_id: args.channel,
          error: message,
        })
        await post(buildPlanApprovalBlocks(cardArgs))
      }
      posted.push({ planId: created.planId, title: cardArgs.title })
    } catch (err) {
      logError('slack.plan.approval_card.error', err, {
        plan_id: created.planId,
        session_id: args.sessionId,
        slack_channel_id: args.channel,
      })
    }
  }

  return posted
}
