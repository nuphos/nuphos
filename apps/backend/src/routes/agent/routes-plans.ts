import { isPlanReadyForApproval } from '@/lib/agent/plan-readiness'
import { journalPlanDecision } from '@/lib/agent/journal-capture'
import { resumeSlackThreadForApprovedPlan } from '@/lib/agent/plan-slack-resume'
import {
  createPlan,
  getPlan,
  getTeamPlanApprovalRequirement,
  listPlans,
  recordPlanApproval,
  retryPlan,
  updatePlan,
  updateTeamPlanApprovalRequirement,
} from '@/lib/agent/plans'
import {
  normalizeAgentPlanUpdatePatch,
  planApprovalPolicyGetOperation,
  planApprovalPolicyUpdateOperation,
  planApproveOperation,
  planCreateOperation,
  planGetOperation,
  planIdPathSchema,
  planListOperation,
  planUpdateOperation,
} from '@/lib/api/plans'
import { AppError } from '@/lib/errors'
import { getTeamMembers, getTeamMembership } from '@/lib/identity'
import { logError } from '@/lib/observability'

import { defineAgentApiRoute, parseWithSchema } from './api-route'
import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import type { PlanDTO, UpdatePlanPatch } from '@/lib/agent/plans'

defineAgentApiRoute(planCreateOperation, async (c, { body: parsed }) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, parsed.teamId))
  const { teamId: _bodyTeamId, ...planInput } = parsed
  const plan = await createPlan({ ...planInput, createdBy: userId, teamId })

  return c.json(plan)
})

defineAgentApiRoute(planListOperation, async (c, { query }) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, query.teamId))
  const mine = query.mine === '1' || query.mine === 'true'
  const result = await listPlans({
    teamId,
    // No teamId AND not explicitly mine → scope to creator so users without a
    // team don't see each other's personal plans.
    createdBy: !teamId || mine ? userId : undefined,
    limit: query.limit,
    cursor: query.cursor,
  })

  return c.json(result)
})

defineAgentApiRoute(planGetOperation, async (c, { path }) => {
  // `:planId` is the plan number (#N) — the public id. Lookup is scoped by
  // team (team plans) or the caller (personal plans).
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const plan = await getPlan(path.planId, { teamId, userId })

  if (!plan) throw new AppError(404, 'not_found', 'Plan not found')

  return c.json(plan)
})

async function approvePlanForCaller(input: {
  planId: string
  teamId?: string
  userId: string
}): Promise<{ plan: PlanDTO; thresholdReached: boolean }> {
  const current = await getPlan(input.planId, { teamId: input.teamId, userId: input.userId })

  if (!current) throw new AppError(404, 'not_found', 'Plan not found')
  if (current.status !== 'proposed') {
    throw new AppError(409, 'plan_not_proposed', 'Only proposed plans can be approved')
  }
  if (!isPlanReadyForApproval(current)) {
    throw new AppError(
      409,
      'plan_incomplete',
      'Plan must include steps, cost, and risk before approval',
    )
  }

  const result = await recordPlanApproval(
    input.planId,
    { teamId: input.teamId, userId: input.userId },
    input.userId,
  )

  if (!result.plan) throw new AppError(404, 'not_found', 'Plan not found')
  if (result.thresholdReached) {
    await journalPlanDecision(
      result.plan,
      { userId: input.userId, teamId: input.teamId ?? null },
      'approved',
    )
    // If this plan's conversation is a Slack thread, that thread is the only
    // place it can execute — approving here and stopping would leave it at
    // `approved` forever (lib/agent/plan-slack-resume.ts). Detached on purpose:
    // starting a turn is not this request's job, and it must not be able to
    // fail the approval that already landed.
    const sessionId = result.plan.sourceConversationId
    const planNumber = String(result.plan.number)

    if (sessionId) {
      void resumeSlackThreadForApprovedPlan({
        sessionId,
        planId: planNumber,
        planTitle: result.plan.title || 'plan',
        approverNuphosUserId: input.userId,
      }).catch((err: unknown) => {
        logError('agent.plan.slack_resume_failed', err, {
          plan_id: planNumber,
          session_id: sessionId,
          user_id: input.userId,
        })
      })
    }
  }

  return { plan: result.plan, thresholdReached: result.thresholdReached }
}

defineAgentApiRoute(planApproveOperation, async (c, { path, body }) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))
  const { plan } = await approvePlanForCaller({ planId: path.planId, teamId, userId })

  return c.json(plan)
})

defineAgentApiRoute(planApprovalPolicyGetOperation, async (c, { query }) => {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, query.teamId))

  if (!teamId) throw new AppError(400, 'invalid_request', 'teamId is required')

  return c.json(await getTeamPlanApprovalRequirement(teamId))
})

defineAgentApiRoute(planApprovalPolicyUpdateOperation, async (c, { body }) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  if (!teamId) throw new AppError(400, 'invalid_request', 'teamId is required')
  const membership = await getTeamMembership(userId, teamId)

  if (membership?.role !== 'ADMINISTRATOR') {
    throw new AppError(403, 'forbidden', 'Only team administrators can change plan approval policy')
  }
  const members = await getTeamMembers(teamId)
  const maximumOtherApprovals = Math.max(0, members.length - 1)

  if (body.minimumOtherApprovals > maximumOtherApprovals) {
    throw new AppError(
      400,
      'invalid_body',
      `This team can require at most ${String(maximumOtherApprovals)} other approval(s)`,
    )
  }
  const requirement = await updateTeamPlanApprovalRequirement({
    teamId,
    requesterApprovalRequired: body.requesterApprovalRequired,
    minimumOtherApprovals: body.minimumOtherApprovals,
    updatedBy: userId,
  })

  return c.json(requirement)
})

defineAgentApiRoute(planUpdateOperation, async (c, { path, body: parsed }) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, parsed.teamId))
  const { teamId: _bodyTeamId, ...parsedPatch } = parsed
  // Construction fields arrive via the plan skill's REST path — apply the
  // same trims/truncation the plan tools used to do, each field
  // independently (partial cost/risk patches must not skip truncation).
  const patch: UpdatePlanPatch = normalizeAgentPlanUpdatePatch(parsedPatch)
  let currentPlan: Awaited<ReturnType<typeof getPlan>> | null = null

  async function loadCurrentPlan() {
    currentPlan ??= await getPlan(path.planId, { teamId, userId })
    if (!currentPlan) throw new AppError(404, 'not_found', 'Plan not found')

    return currentPlan
  }
  // Backward compatibility for existing desktop clients: the old
  // PATCH {status:"approved"} shape records one approval against the policy
  // snapshot instead of bypassing quorum. Approval is intentionally isolated
  // from content edits so the statement being approved cannot change in the
  // same request.
  if (patch.status === 'approved') {
    if (Object.keys(parsedPatch).some((key) => key !== 'status')) {
      throw new AppError(400, 'invalid_body', 'Approval cannot be combined with other plan changes')
    }
    const { plan } = await approvePlanForCaller({ planId: path.planId, teamId, userId })

    return c.json(plan)
  }
  if (patch.status === 'executing') {
    // Execution must follow an explicit approval — never let this generic patch
    // endpoint imply approval by backfilling approvedBy. updatePlan() also blocks
    // the proposed -> executing transition atomically; this check is for a clear error.
    const current = await loadCurrentPlan()

    if (current.status === 'proposed') {
      throw new AppError(409, 'plan_not_approved', 'Plan must be approved before execution')
    }
    patch.executionStartedAt = new Date()
  }
  if (patch.status === 'completed' || patch.status === 'failed') {
    patch.executionFinishedAt = new Date()
  }
  if (patch.status === 'rejected') patch.rejectedBy = userId
  const plan = await updatePlan(path.planId, patch, { teamId, userId })

  if (!plan) throw new AppError(404, 'not_found', 'Plan not found')
  // Record the human decision on the conversation's tamper-evident chain — the
  // trust root that a tool intent's plan-approved attribution points back at.
  if (patch.status === 'rejected') {
    await journalPlanDecision(plan, { userId, teamId: teamId ?? null }, patch.status)
  }

  return c.json(plan)
})

agent.post('/plans/:planId/retry', async (c) => {
  const userId = c.get('userId')
  const path = parseWithSchema(planIdPathSchema, c.req.param(), 'invalid_request')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const current = await getPlan(path.planId, { teamId, userId })

  if (!current) throw new AppError(404, 'not_found', 'Plan not found')
  if (current.status !== 'failed') {
    throw new AppError(409, 'plan_not_failed', 'Only failed plans can be retried')
  }
  const plan = await retryPlan(path.planId, { teamId, userId })

  if (!plan) throw new AppError(404, 'not_found', 'Plan not found')

  return c.json(plan)
})

// ── Auto Mode (per-command authorization) ────────────────────────────────
// See lib/agent/auto-mode. These endpoints back the desktop approval UI and
// are equally usable via curl for local testing.

// The user's standing policy — all rules (proposed + active). Powers the
