import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'

/** The web link that opens this agent session for anyone in the team. */
export function agentSessionUrl(teamId: string, sessionId: string) {
  const location = pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: sessionId }),
  )

  return toAbsoluteAtlasUrl(location.href)
}
