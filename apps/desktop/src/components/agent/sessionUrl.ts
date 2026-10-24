import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'

/** The web link that opens this agent session for anyone in the team. */
export function agentSessionUrl(teamId: string, sessionId: string) {
  const location = pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId }, 'team.agent', { agentSessionId: sessionId }),
  )

  return toAbsoluteAtlasUrl(location.href)
}

/**
 * The web link that opens one version of an artifact beside its conversation.
 * It grants nothing: whoever opens it sees the artifact only if they can
 * already read the conversation.
 */
export function agentArtifactUrl(
  teamId: string,
  sessionId: string,
  artifactId: string,
  version: number,
) {
  const location = pageLocationForNavigation(
    emptyNavigation({ kind: 'team', teamId }, 'team.agent', {
      agentSessionId: sessionId,
      agentArtifact: { artifactId, version },
    }),
  )

  return toAbsoluteAtlasUrl(location.href)
}
