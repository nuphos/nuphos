const NUPHOS_APP_ORIGIN = 'https://nuphos.ai'

function segment(value: string): string {
  return encodeURIComponent(value)
}

export type AgentSessionResourceContext = {
  sessionId: string
  teamId: string
}

/**
 * Stable links shared by Nuphos-owned resource responses in the native runtime.
 * Protocol-shaped responses (MCP, ExecCredential, and third-party proxies) must
 * remain byte-compatible with their owning protocol and should not use this.
 */
export function agentSessionResourceLinks(context: AgentSessionResourceContext) {
  const sessionId = segment(context.sessionId)
  const teamId = segment(context.teamId)

  return {
    team: `${NUPHOS_APP_ORIGIN}/teams/${teamId}`,
    conversation: `${NUPHOS_APP_ORIGIN}/teams/${teamId}/agent/${sessionId}`,
    apiRoot: `/agent-sessions/${sessionId}/teams/${teamId}`,
  }
}

export function planResourceLinks(context: AgentSessionResourceContext, planId?: string) {
  const shared = agentSessionResourceLinks(context)
  const collection = `${shared.apiRoot}/plans`
  const appCollection = `${shared.team}/plans`

  return {
    ...shared,
    collection,
    appCollection,
    ...(planId
      ? {
          self: `${collection}/${segment(planId)}`,
          app: `${appCollection}/${segment(planId)}`,
        }
      : {}),
  }
}
