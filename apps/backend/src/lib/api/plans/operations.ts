import { planApprovalRequirementSchema, planSchema } from './core-schemas'
import {
  listPlansAgentInputSchema,
  listPlansQuerySchema,
  listPlansResponseSchema,
  planApprovalPolicyQuerySchema,
  planIdPathSchema,
} from './update-schemas'

import type { ApiOperation } from '../registry'

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

export const planApiOperations = [
  planListOperation,
  planGetOperation,
  planApprovalPolicyGetOperation,
] as const satisfies readonly ApiOperation[]
