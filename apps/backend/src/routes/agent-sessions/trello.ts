import { Hono } from 'hono'
import { z } from 'zod'

import { executeTrelloTool } from '@/lib/byos/trello'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTrelloIntegration, requireTrelloMemberAccess } from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { AgentTrelloVars } from '@/routes/agent-sessions/shared'

export const trelloScoped = new Hono<{ Variables: AgentTrelloVars }>()

trelloScoped.use('*', requireTrelloIntegration())
trelloScoped.use('*', requireTrelloMemberAccess())
trelloScoped.use('*', async (c, next) => {
  const access = await getAgentCredentialAccess(c.get('agent'), c.get('teamId'))

  if (!access.trelloIntegrationIds?.includes(c.get('trelloIntegrationId'))) {
    throw new AppError(
      403,
      'trello_agent_access_denied',
      'This Trello account is not selected for this session',
    )
  }
  await next()
})
trelloScoped.post(
  '/execute',
  zv(
    'json',
    z
      .object({
        tool: z.string().max(100),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
  ),
  async (c) => {
    const binding = c.get('trelloBinding')
    const body = c.req.valid('json')

    c.header('Cache-Control', 'no-store, private')

    return c.json(
      await executeTrelloTool(
        binding.composioAccountId,
        binding.composioUserId,
        body.tool,
        body.arguments,
      ),
    )
  },
)
