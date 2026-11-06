import { getAgentCredentialOptions } from './credential-options'
import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

agent.get('/credential-options', async (c) => {
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))

  return c.json(await getAgentCredentialOptions(teamId, userId))
})
