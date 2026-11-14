import { z } from 'zod'

import { planSchema } from './core-schemas'

export const listPlansQuerySchema = z.object({
  teamId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().datetime().optional(),
  mine: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
})

export const listPlansAgentInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum plans to return. Default 50.'),
  cursor: z
    .string()
    .datetime()
    .optional()
    .describe('Pagination cursor from a previous list result.'),
  mine: z.boolean().optional().describe('When true, list only plans created by the current user.'),
})

export const listPlansResponseSchema = z.object({
  plans: z.array(planSchema),
  nextCursor: z.string().datetime().nullable(),
  hasMore: z.boolean(),
})

export const planIdPathSchema = z.object({
  planId: z.string().min(1).describe('Public plan id, e.g. "2".'),
})

export const planApprovalPolicyQuerySchema = z.object({
  teamId: z.string().min(1),
})

export type ListPlansAgentInput = z.infer<typeof listPlansAgentInputSchema>
