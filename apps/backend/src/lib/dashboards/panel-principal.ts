import { ObjectId } from 'mongodb'

import { signClaims, signedPayload } from '@/lib/claude-code-preview/mcp-token'
import { dashboardPanels } from '@/models'

import type { AgentRef } from '@/lib/agents/identity'

const AUDIENCE = 'nuphos-dashboard-panel'
const SESSION_PREFIX = 'dashboard-panel-'

export type DashboardPanelClaims = {
  aud: typeof AUDIENCE
  /** The panel's execution principal (its script author). */
  sub: string
  tid: string
  pid: string
  iat: number
  exp: number
}

export function mintDashboardPanelToken(args: {
  userId: string
  teamId: string
  panelId: string
  ttlSec: number
}): string {
  const now = Math.floor(Date.now() / 1000)
  const claims: DashboardPanelClaims = {
    aud: AUDIENCE,
    sub: args.userId,
    tid: args.teamId,
    pid: args.panelId,
    iat: now,
    exp: now + args.ttlSec,
  }

  return signClaims(claims)
}

export function verifyDashboardPanelToken(token: string): DashboardPanelClaims | null {
  const claims = signedPayload(token)

  if (claims?.aud !== AUDIENCE) return null
  if (typeof claims.sub !== 'string' || !ObjectId.isValid(claims.sub)) return null
  if (typeof claims.tid !== 'string' || !ObjectId.isValid(claims.tid)) return null
  if (typeof claims.pid !== 'string' || !ObjectId.isValid(claims.pid)) return null
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null

  return claims as DashboardPanelClaims
}

/** A panel acts through the agent-session credential routes under this id. */
export function dashboardPanelSessionId(panelId: string): string {
  return `${SESSION_PREFIX}${panelId}`
}

export function dashboardPanelIdFromSessionId(sessionId: string): ObjectId | null {
  if (!sessionId.startsWith(SESSION_PREFIX)) return null
  const id = sessionId.slice(SESSION_PREFIX.length)

  return ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null
}

/** The agent identity a live panel token acts as; null once the panel is gone. */
export async function dashboardPanelAgent(claims: DashboardPanelClaims): Promise<AgentRef | null> {
  const panel = await dashboardPanels().findOne(
    { _id: new ObjectId(claims.pid), teamId: new ObjectId(claims.tid) },
    { projection: { _id: 1 } },
  )

  return panel ? { userId: claims.sub, sessionId: dashboardPanelSessionId(claims.pid) } : null
}
