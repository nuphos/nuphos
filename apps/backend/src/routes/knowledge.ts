import { createZeaburContext, zeaburTools } from '@zeabur/ai-sdk'
import { Hono } from 'hono'
import { z } from 'zod'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import type { TeamAuthVariables } from '@/middleware/auth'

export const knowledgeRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const searchSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().optional(),
})
const issueSchema = z.object({
  type: z.enum(['outdated', 'incorrect', 'missing']),
  chunk_id: z.string().min(1),
  detail: z.string().min(1),
})
const contributionSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
})

function context(c: { get(key: 'authToken'): string }) {
  if (!config.agent.ragApiKey) {
    throw new AppError(503, 'knowledge_unavailable', 'The knowledge service is not configured')
  }

  return createZeaburContext(c.get('authToken'), undefined, config.agent.ragApiKey)
}

knowledgeRoutes.post('/search', zv('json', searchSchema), async (c) =>
  c.json(await zeaburTools.queryZeaburKnowledgeBase(c.req.valid('json'), context(c))),
)

knowledgeRoutes.post('/issues', zv('json', issueSchema), async (c) =>
  c.json(await zeaburTools.reportKnowledgeIssue(c.req.valid('json'), context(c))),
)

knowledgeRoutes.post('/contributions', zv('json', contributionSchema), async (c) =>
  c.json(await zeaburTools.contributeNewKnowledge(c.req.valid('json'), context(c))),
)
