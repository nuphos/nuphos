import { Hono } from 'hono'

import type { AgentZeaburVars } from '@/routes/agent-sessions/shared'
import type { Context, MiddlewareHandler } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { decryptZeaburToken } from '@/lib/byos/secrets'
import { listZeaburProjects, listZeaburServers } from '@/lib/byos/zeabur'
import { AppError } from '@/lib/errors'
import { requireZeaburProvider } from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

export const zeaburScoped = new Hono<{ Variables: AgentZeaburVars }>()

zeaburScoped.use('*', requireZeaburProvider())
zeaburScoped.use('*', requireSelectedZeaburAgentCredential())

zeaburScoped.get('/credentials', (c) => {
  const agent = c.get('agent')

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')

  return c.json({
    zeaburId: c.get('zeaburId'),
    kind: c.get('zeaburKind'),
    name: c.get('zeaburName'),
    token: decryptZeaburToken(c.get('zeaburEncryptedToken')),
    authType: 'personal_access_token',
  })
})

function handle(c: Context<{ Variables: AgentZeaburVars }>) {
  return {
    token: decryptZeaburToken(c.get('zeaburEncryptedToken')),
    zeaburId: c.get('zeaburId'),
    kind: c.get('zeaburKind'),
  }
}

zeaburScoped.get('/projects', async (c) => {
  const projects = await listZeaburProjects(handle(c))

  return c.json({ projects })
})

zeaburScoped.get('/servers', async (c) => {
  const servers = await listZeaburServers(handle(c))

  return c.json({ servers })
})

function requireSelectedZeaburAgentCredential(): MiddlewareHandler<{ Variables: AgentZeaburVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedZeaburIds = credentialAccess.zeaburIds

    if (selectedZeaburIds.length === 0) {
      throw new AppError(
        403,
        'zeabur_provider_agent_access_denied',
        'This agent session has no selected Zeabur providers',
      )
    }

    const zeaburId = c.get('zeaburId')

    if (!selectedZeaburIds.includes(zeaburId)) {
      throw new AppError(
        403,
        'zeabur_provider_agent_access_denied',
        'This Zeabur provider is not enabled for this agent session',
      )
    }
    await next()
  }
}
