// Scoped bearer for the Claude Code runtime's MCP calls. The runtime endpoint
// a conversation lands on is team-admin-configurable, so it must never see the
// user's general session token: this HS256 JWT is accepted only by the
// conversation-aware API middleware. It is accepted only when the requested
// operation matches the (session, team) and explicit capability it was minted
// for; it never becomes a general Nuphos session token.
import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

const AUDIENCE = 'nuphos-preview-mcp'
const DEFAULT_TTL_SEC = 24 * 60 * 60

export type PreviewMcpClaims = {
  aud: typeof AUDIENCE
  /** Execution actor. */
  sub: string
  /** Durable conversation owner. */
  own: string
  sid: string
  tid: string
  ori: string
  iat: number
  exp: number
}

function secret(): string {
  const value = config.auth.jwtSecret

  if (!value) {
    throw new AppError(503, 'jwt_secret_unavailable', 'NUPHOS_JWT_SECRET is required')
  }

  return value
}

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function sign(headerAndPayload: string): string {
  return createHmac('sha256', secret()).update(headerAndPayload).digest('base64url')
}

export function mintPreviewMcpToken(args: {
  userId: string
  conversationOwnerUserId?: string
  sessionId: string
  teamId: string
  apiOrigin?: string
  ttlSec?: number
}): string {
  const now = Math.floor(Date.now() / 1000)
  const claims: PreviewMcpClaims = {
    aud: AUDIENCE,
    sub: args.userId,
    own: args.conversationOwnerUserId ?? args.userId,
    sid: args.sessionId,
    tid: args.teamId,
    ori: (args.apiOrigin ?? 'https://api.nuphos.ai').replace(/\/$/u, ''),
    iat: now,
    exp: now + (args.ttlSec ?? DEFAULT_TTL_SEC),
  }

  return signClaims(claims)
}

export function signClaims(claims: object): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  const signature = sign(`${head}.${payload}`)

  return `${head}.${payload}.${signature}`
}

/** The payload of a token this backend signed, before any claim checks. */
export function signedPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')

  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  const expected = sign(`${parts[0]}.${parts[1]}`)
  const given = Buffer.from(parts[2])
  const wanted = Buffer.from(expected)

  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown

    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Whether an agent-session request path is inside the token's scope: anything under the
 * conversation's own `/agent-sessions/:sessionId/teams/:teamId/` mount (MCP
 * endpoints, credential vending, kubeconfig exec-credential fetches), with or
 * without the mount prefix — the internal vend dispatch calls the sub-app
 * directly.
 */
export function scopedPathAllowed(path: string, claims: Pick<PreviewMcpClaims, 'sid' | 'tid'>) {
  const match = /^(?:\/agent-sessions)?\/([^/]+)\/teams\/([^/]+)\//u.exec(path)

  return match !== null && match[1] === claims.sid && match[2] === claims.tid
}

/** Claims when the token is a valid, unexpired preview-MCP token; else null. */
export function verifyPreviewMcpToken(token: string): PreviewMcpClaims | null {
  const payload = signedPayload(token)

  if (!payload) return null
  const claims = payload as PreviewMcpClaims

  if (claims.aud !== AUDIENCE) return null
  if (typeof claims.sub !== 'string' || !claims.sub) return null
  // Tokens minted before the owner/actor split are same-principal tokens.
  // Normalize them here so a rolling deploy does not strand active turns.
  if (typeof claims.own === 'undefined') claims.own = claims.sub
  if (typeof claims.own !== 'string' || !claims.own) return null
  if (typeof claims.sid !== 'string' || !claims.sid) return null
  if (typeof claims.tid !== 'string' || !claims.tid) return null
  if (typeof claims.ori !== 'string' || !claims.ori) return null
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null

  return claims
}
