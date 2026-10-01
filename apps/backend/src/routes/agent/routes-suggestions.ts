import { generateStarterSuggestions } from '@/lib/agent/starter-suggestions'
import { AppError } from '@/lib/errors'

import { getAgentCredentialOptions } from './credential-options'
import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

agent.get('/credential-options', async (c) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  return c.json(await getAgentCredentialOptions(teamId, userId))
})

// LLM-generated starter questions tailored to the resources a team has just
// connected. Drives the agent home page's "Suggested for your setup" cards.
// Best-effort: on any generation failure we return an empty list and the client
// silently shows nothing rather than an error.
agent.post('/starter-suggestions', async (c) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  if (!teamId) throw new AppError(400, 'invalid_request', 'Missing teamId')
  const body = (await c.req
    .json<{ resources?: unknown; locale?: unknown }>()
    .catch(() => ({}))) as { resources?: unknown; locale?: unknown }
  const resources = Array.isArray(body.resources)
    ? body.resources.filter((r: unknown): r is string => typeof r === 'string')
    : []
  const locale = typeof body.locale === 'string' ? body.locale : 'en-US'
  const suggestions = await generateStarterSuggestions(resources, locale, { userId, teamId })

  return c.json({ suggestions })
})
