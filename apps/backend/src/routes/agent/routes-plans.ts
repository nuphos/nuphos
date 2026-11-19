import {
  assertPlanAccess,
  getPlan,
  getTeamPlanApprovalRequirement,
  listPlans,
} from '@/lib/agent/plans'
import {
  planApprovalPolicyGetOperation,
  planGetOperation,
  planListOperation,
} from '@/lib/api/plans'
import { AppError } from '@/lib/errors'
import { unreadableSessionIds } from '@/routes/agent-journal/shared'

import { defineAgentApiRoute } from './api-route'
import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

defineAgentApiRoute(planListOperation, async (c, { query }) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, query.teamId))
  const mine = query.mine === '1' || query.mine === 'true'
  const result = await listPlans({
    teamId,
    // No teamId AND not explicitly mine → scope to creator so users without a
    // team don't see each other's personal plans.
    createdBy: !teamId || mine ? userId : undefined,
    // Filtered in the query, so every page is full and its cursor is right.
    viewerId: userId,
    limit: query.limit,
    cursor: query.cursor,
  })
  // The query applies readableByFilter; readsConversation stays the authority (team scope of
  // an agent token, a teamless conversation), so a plan it refuses is still dropped here.
  const hidden = await unreadableSessionIds(
    [...new Set(result.plans.flatMap((plan) => plan.sourceConversationId ?? []))],
    userId,
  )

  return c.json({
    ...result,
    plans: result.plans.filter((plan) => !hidden.has(plan.sourceConversationId ?? '')),
  })
})

defineAgentApiRoute(planGetOperation, async (c, { path }) => {
  // `:planId` is the plan number (#N) — the public id. Lookup is scoped by
  // team (team plans) or the caller (personal plans).
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const plan = await getPlan(path.planId, { teamId, userId })

  if (!plan) throw new AppError(404, 'not_found', 'Plan not found')
  await assertPlanAccess(plan, userId, 'read')

  return c.json(plan)
})

defineAgentApiRoute(planApprovalPolicyGetOperation, async (c, { query }) => {
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, query.teamId))

  if (!teamId) throw new AppError(400, 'invalid_request', 'teamId is required')

  return c.json(await getTeamPlanApprovalRequirement(teamId))
})

// Plans are retired in favour of approval decisions (#2316). Released clients
// still read them as history; anything that would change one gets a stable answer.
function retired(): never {
  throw new AppError(
    410,
    'plans_retired',
    'Plans are retired. Agents now ask for approval with a decision in the Inbox.',
  )
}

agent.patch('/plans/:planId', retired)
agent.post('/plans/:planId/approvals', retired)
agent.post('/plans/:planId/retry', retired)
agent.put('/plan-approval-policy', retired)
