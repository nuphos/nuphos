import { agentCreatePlanInputSchema } from './agent-schemas'
import { createPlanBodySchema, planApprovalRequirementSchema, planSchema } from './core-schemas'
import {
  agentUpdatePlanBodyFieldsSchema,
  listPlansAgentInputSchema,
  listPlansQuerySchema,
  listPlansResponseSchema,
  planApprovalPolicyQuerySchema,
  planIdPathSchema,
  recordPlanApprovalBodySchema,
  updatePlanApprovalPolicyBodySchema,
  updatePlanBodySchema,
} from './update-schemas'

import type { ApiOperation } from '../registry'

export const planCreateOperation = {
  operationId: 'plans.create',
  method: 'post',
  path: '/agent/plans',
  tags: ['Plans'],
  summary: 'Create a plan',
  description: 'Create a team-scoped or personal execution plan.',
  auth: 'bearer',
  requestSchema: createPlanBodySchema,
  responseSchema: planSchema,
  agent: {
    toolName: 'plan_create',
    readOnly: false,
    description:
      'Create and persist only the metadata shell for a plan: title and overview. Do not include decisions, steps, cost, or risk here; fill those with PATCH /agent/plans/{planId} as documented in the plan skill.',
    inputSchema: agentCreatePlanInputSchema,
  },
} satisfies ApiOperation

export const planListOperation = {
  operationId: 'plans.list',
  method: 'get',
  path: '/agent/plans',
  tags: ['Plans'],
  summary: 'List plans',
  description: 'List recent plans visible to the current team or current user.',
  auth: 'bearer',
  querySchema: listPlansQuerySchema,
  responseSchema: listPlansResponseSchema,
  agent: {
    toolName: 'plan_list',
    readOnly: true,
    description:
      'List recent plans visible in the current Nuphos team context. Use this when the user asks for plan list, recent plans, or plan status without naming a plan id.',
    inputSchema: listPlansAgentInputSchema,
  },
} satisfies ApiOperation

export const planGetOperation = {
  operationId: 'plans.get',
  method: 'get',
  path: '/agent/plans/{planId}',
  tags: ['Plans'],
  summary: 'Get a plan',
  description: 'Fetch one plan by public plan id, scoped to the current team or user.',
  auth: 'bearer',
  pathSchema: planIdPathSchema,
  responseSchema: planSchema,
  agent: {
    toolName: 'plan_get',
    readOnly: true,
    description: 'Fetch a plan by id and return its latest lifecycle and per-command status.',
    inputSchema: planIdPathSchema,
  },
} satisfies ApiOperation

export const planUpdateOperation = {
  operationId: 'plans.update',
  method: 'patch',
  path: '/agent/plans/{planId}',
  tags: ['Plans'],
  summary: 'Update a plan',
  description:
    'Update plan lifecycle or per-command progress, or build/revise a still-proposed plan: ' +
    'decisions, appendStep (+insertAt), editStep, removeStep, title/overview, cost, and risk fields. ' +
    'Content revisions are rejected once the plan is approved.',
  auth: 'bearer',
  pathSchema: planIdPathSchema,
  requestSchema: updatePlanBodySchema,
  responseSchema: planSchema,
  agent: {
    toolName: 'plan_update',
    readOnly: false,
    description: 'Update a plan as work happens: set lifecycle status or per-command statuses.',
    inputSchema: planIdPathSchema.merge(agentUpdatePlanBodyFieldsSchema),
    requiresNonEmptyPatch: true,
  },
} satisfies ApiOperation

export const planApproveOperation = {
  operationId: 'plans.approve',
  method: 'post',
  path: '/agent/plans/{planId}/approvals',
  tags: ['Plans'],
  summary: 'Approve a plan',
  description:
    'Record the current human as an approver. The plan becomes approved only when its policy snapshot is satisfied.',
  auth: 'bearer',
  pathSchema: planIdPathSchema,
  requestSchema: recordPlanApprovalBodySchema,
  responseSchema: planSchema,
} satisfies ApiOperation

export const planApprovalPolicyGetOperation = {
  operationId: 'plans.getApprovalPolicy',
  method: 'get',
  path: '/agent/plan-approval-policy',
  tags: ['Plans'],
  summary: 'Get the team plan approval policy',
  description: 'Return the approval requirement that new plans snapshot for this team.',
  auth: 'bearer',
  querySchema: planApprovalPolicyQuerySchema,
  responseSchema: planApprovalRequirementSchema,
} satisfies ApiOperation

export const planApprovalPolicyUpdateOperation = {
  operationId: 'plans.updateApprovalPolicy',
  method: 'put',
  path: '/agent/plan-approval-policy',
  tags: ['Plans'],
  summary: 'Update the team plan approval policy',
  description: 'Administrator-only. Invalidates approvals on proposed team plans.',
  auth: 'bearer',
  requestSchema: updatePlanApprovalPolicyBodySchema,
  responseSchema: planApprovalRequirementSchema,
} satisfies ApiOperation

export const planApiOperations = [
  planCreateOperation,
  planListOperation,
  planGetOperation,
  planUpdateOperation,
  planApproveOperation,
  planApprovalPolicyGetOperation,
  planApprovalPolicyUpdateOperation,
] as const satisfies readonly ApiOperation[]
