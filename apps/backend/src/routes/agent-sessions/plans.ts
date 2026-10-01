import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'

import { createPlan, getPlan, listPlans, updatePlan } from '@/lib/agent/plans'
import {
  agentCreatePlanInputSchema,
  agentUpdatePlanBodyFieldsSchema,
  createPlanBodySchema,
  normalizeAgentCreatePlanInput,
  normalizeAgentFullPlanInput,
  normalizeAgentPlanUpdatePatch,
} from '@/lib/api/plans'
import { publishPreviewFrame } from '@/lib/claude-code-preview/run-frame-bridge'
import { AppError } from '@/lib/errors'
import { planResourceLinks } from '@/routes/agent-sessions/resource-links'

import type { UpdatePlanPatch } from '@/lib/agent/plans'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { AgentVars } from '@/routes/agent-sessions/shared'
import type { z } from 'zod'

const updateSchema = agentUpdatePlanBodyFieldsSchema.refine(
  (value) => Object.keys(value).length > 0,
  'patch must include at least one plan field',
)
const completeProposalSchema = createPlanBodySchema.omit({ teamId: true })

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)

  if (!result.success) {
    throw new AppError(400, 'invalid_body', result.error.issues[0]?.message ?? 'Invalid body')
  }

  return result.data
}

export const previewPlans = new Hono<{ Variables: AgentVars & TeamAuthVariables }>()

function linkedPlan<T extends { id: string }>(plan: T, teamId: string, sessionId: string) {
  return {
    ...plan,
    _links: planResourceLinks({ teamId, sessionId }, plan.id),
  }
}

previewPlans.post('/', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const input = normalizeAgentCreatePlanInput(parse(agentCreatePlanInputSchema, await c.req.json()))
  const plan = await createPlan({
    teamId,
    createdBy: agent.userId,
    sourceConversationId: agent.sessionId,
    title: input.title,
    overview: input.overview,
    steps: [],
  })
  const toolCallId = `nuphos-plan-${randomUUID()}`
  const ctx = {
    userId: agent.userId,
    sessionId: agent.sessionId,
    conversationOwnerUserId: agent.conversationOwnerUserId,
  }

  await publishPreviewFrame(ctx, {
    type: 'tool-input-available',
    toolCallId,
    toolName: 'plan_create',
    input: { title: input.title, overview: input.overview },
  }).catch(() => {})
  await publishPreviewFrame(ctx, {
    type: 'tool-output-available',
    toolCallId,
    output: { planId: plan.id, status: plan.status },
  }).catch(() => {})

  return c.json(linkedPlan(plan, teamId, agent.sessionId), 201)
})

// Atomic complete-card creation for Claude Code's propose.sh. A multi-request
// create+patch sequence can strand a proposed shell when any later section is
// invalid or the transport drops; that shell activates the approval gate and
// leaves the UI permanently saying "Building plan". Validate everything
// before allocating the plan number or publishing its live tool frame.
previewPlans.post('/proposals', async (c) => {
  const agent = c.get('agent')
  const teamId = c.get('teamId')
  const input = normalizeAgentFullPlanInput(parse(completeProposalSchema, await c.req.json()))
  const plan = await createPlan({
    ...input,
    teamId,
    createdBy: agent.userId,
    sourceConversationId: agent.sessionId,
  })
  const toolCallId = `nuphos-plan-${randomUUID()}`
  const ctx = {
    userId: agent.userId,
    sessionId: agent.sessionId,
    conversationOwnerUserId: agent.conversationOwnerUserId,
  }

  await publishPreviewFrame(ctx, {
    type: 'tool-input-available',
    toolCallId,
    toolName: 'plan_create',
    input: { title: input.title, overview: input.overview },
  }).catch(() => {})
  await publishPreviewFrame(ctx, {
    type: 'tool-output-available',
    toolCallId,
    output: { planId: plan.id, status: plan.status },
  }).catch(() => {})

  return c.json(linkedPlan(plan, teamId, agent.sessionId), 201)
})

previewPlans.get('/', async (c) => {
  const agent = c.get('agent')

  const teamId = c.get('teamId')
  const result = await listPlans({
    teamId,
    createdBy: agent.userId,
    sourceConversationId: agent.sessionId,
  })

  return c.json({
    ...result,
    plans: result.plans.map((plan) => linkedPlan(plan, teamId, agent.sessionId)),
    _links: planResourceLinks({ teamId, sessionId: agent.sessionId }),
  })
})

previewPlans.get('/:planId', async (c) => {
  const agent = c.get('agent')
  const plan = await getPlan(c.req.param('planId'), {
    teamId: c.get('teamId'),
    userId: agent.userId,
    sourceConversationId: agent.sessionId,
  })

  if (!plan) throw new AppError(404, 'not_found', 'Plan not found')

  return c.json(linkedPlan(plan, c.get('teamId'), agent.sessionId))
})

previewPlans.patch('/:planId', async (c) => {
  const agent = c.get('agent')
  const scope = {
    teamId: c.get('teamId'),
    userId: agent.userId,
    sourceConversationId: agent.sessionId,
  }
  const parsed = parse(updateSchema, await c.req.json())
  const patch: UpdatePlanPatch = normalizeAgentPlanUpdatePatch(parsed)

  if (patch.status === 'executing') patch.executionStartedAt = new Date()
  if (patch.status === 'completed' || patch.status === 'failed') {
    patch.executionFinishedAt = new Date()
  }
  const plan = await updatePlan(c.req.param('planId'), patch, scope)

  if (plan) return c.json(linkedPlan(plan, scope.teamId, agent.sessionId))
  if (!(await getPlan(c.req.param('planId'), scope))) {
    throw new AppError(404, 'not_found', 'Plan not found')
  }
  throw new AppError(
    409,
    'plan_update_rejected',
    'The Plan state does not allow this update. Reload the Plan and reconcile it.',
  )
})
