import { z } from 'zod'

import type { ApiOperation } from './registry'

export const feedbackRequestSchema = z.object({
  type: z.enum(['bug', 'feature']).describe('`bug` for a defect, `feature` for a request.'),
  title: z.string().trim().min(5).max(200).describe('One-line summary.'),
  description: z
    .string()
    .trim()
    .min(20)
    .max(20_000)
    .describe(
      'What happened or what is wanted: steps, expected vs actual behavior, error output. ' +
        'Never include secrets, tokens, or private data.',
    ),
  source: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe('Optional reporter identifier, e.g. the agent or client name and version.'),
})

const feedbackResponseSchema = z.object({
  id: z.string().describe('Id of the recorded report.'),
})

export const feedbackApiOperations = [
  {
    operationId: 'feedback.create',
    method: 'post',
    path: '/feedback',
    tags: ['Feedback'],
    summary: 'Report a Nuphos bug or request a feature',
    description:
      'Public, unauthenticated. Any person or agent that hits a problem using Nuphos, or misses a ' +
      'capability, can file it here. Reports are recorded for the Nuphos team to triage by hand. ' +
      'Rate limited per client; 429 means retry later.',
    auth: 'none',
    requestSchema: feedbackRequestSchema,
    responseSchema: feedbackResponseSchema,
  },
] as const satisfies readonly ApiOperation[]
