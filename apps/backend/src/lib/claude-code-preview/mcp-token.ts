// Scoped bearer for the Claude Code runtime's MCP calls. The runtime endpoint
// a conversation lands on is team-admin-configurable, so it must never see the
// user's general session token: this HS256 JWT is accepted only by the
// conversation-aware API middleware. It is accepted only when the requested
// operation matches the (session, team) and explicit capability it was minted
// for; it never becomes a general Nuphos session token.
//
// With an internal-token signer configured, conversation tokens are ES256 JWTs
// from the dedicated internal issuer (`@/lib/internal-token`) and carry `jti`
// and, when delegated, `act`. Both formats verify, so a rolling deploy does not
// strand HS256 tokens that are still live.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import {
  internalTokenIssuer,
  signInternalToken,
  verifiedInternalPayload,
} from '@/lib/internal-token'
import { logEvent } from '@/lib/observability'

const AUDIENCE = 'nuphos-preview-mcp'
const DEFAULT_TTL_SEC = 24 * 60 * 60

/** RFC 8693 actor chain: the current actor, and whoever delegated to it. */
export type TokenActor = { sub: string; act?: TokenActor }

/**
 * The credentials an exchanged token may vend, per selection field. Every
 * field is present; one that is absent or empty vends nothing.
 */
export type CredentialLimit = Readonly<Record<string, readonly string[]>>

export type PreviewMcpClaims = {
  /** `nuphos-preview-mcp`, followed by `credential:<provider>/<id>` resources on exchanged tokens. */
  aud: typeof AUDIENCE | [typeof AUDIENCE, ...string[]]
  /** Execution actor. */
  sub: string
  /** Durable conversation owner. */
  own: string
  sid: string
  tid: string
  ori: string
  /** Set when `sub` sent this turn's message, so their Personal Credentials apply. */
  hum?: true
  iss?: string
  /** Unique token id, logged at mint for audit and future revocation. Absent on older tokens. */
  jti?: string
  /** RFC 8693 actor: who this token was delegated to, e.g. `session:<parentSid>`. */
  act?: TokenActor
  /** Set on exchanged tokens: the only credentials they may vend. */
  lim?: CredentialLimit
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

export async function mintPreviewMcpToken(args: {
  userId: string
  conversationOwnerUserId?: string
  sessionId: string
  teamId: string
  apiOrigin?: string
  ttlSec?: number
  humanTurn?: boolean
  /** The delegating party, recorded as the RFC 8693 `act` claim. */
  actor?: string | TokenActor
  /** Absolute expiry (seconds); wins over `ttlSec` when it is earlier. */
  expiresAt?: number
  /** Exchanged tokens: the credentials they may vend, and the matching resources. */
  credentialLimit?: CredentialLimit
  resources?: string[]
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const ttlExpiry = now + (args.ttlSec ?? DEFAULT_TTL_SEC)
  const actor = typeof args.actor === 'string' ? { sub: args.actor } : args.actor
  const claims: PreviewMcpClaims = {
    iss: internalTokenIssuer(),
    aud: args.resources?.length ? [AUDIENCE, ...args.resources] : AUDIENCE,
    sub: args.userId,
    own: args.conversationOwnerUserId ?? args.userId,
    sid: args.sessionId,
    tid: args.teamId,
    ori: (args.apiOrigin ?? 'https://api.nuphos.ai').replace(/\/$/u, ''),
    ...(args.humanTurn ? { hum: true as const } : {}),
    jti: randomUUID(),
    ...(actor ? { act: actor } : {}),
    ...(args.credentialLimit ? { lim: args.credentialLimit } : {}),
    iat: now,
    exp: args.expiresAt === undefined ? ttlExpiry : Math.min(ttlExpiry, args.expiresAt),
  }
  const es256 = await signInternalToken(claims)

  logEvent('info', 'auth.conversation_token.minted', {
    jti: claims.jti,
    alg: es256 ? 'ES256' : 'HS256',
    session_id: claims.sid,
    team_id: claims.tid,
    subject: claims.sub,
    actor: claims.act?.sub,
    limited: claims.lim !== undefined,
    expires_at: claims.exp,
  })

  return es256 ?? signClaims(claims)
}

export function signClaims(claims: object): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  const signature = sign(`${head}.${payload}`)

  return `${head}.${payload}.${signature}`
}

/**
 * The payload of a token this backend signed, before any claim checks: an
 * HS256 token, or an ES256 token from the internal issuer.
 */
export function signedPayload(token: string): Record<string, unknown> | null {
  return hs256Payload(token) ?? verifiedInternalPayload(token)
}

function hs256Payload(token: string): Record<string, unknown> | null {
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

// Credential vending only: the credentials MCP, the selection list, and the
// per-provider credential routes. Native tools, plans and file transfers build
// their own context from the conversation, so a limited token is refused there.
const LIMITED_TOKEN_ENDPOINTS = new Set(['/mcp', '/selected-credentials'])
const PROVIDER_ROUTE =
  /^\/[a-z0-9-]+-(?:accounts|projects|integrations|instances|workspaces|sites|clients|providers)\/[^/]+\/./u

/** Whether an exchanged token's credential limit may be honored on this mount path. */
export function limitedTokenPathAllowed(path: string): boolean {
  const suffix = /^(?:\/agent-sessions)?\/[^/]+\/teams\/[^/]+(\/.*)$/u.exec(path)?.[1]

  return (
    suffix !== undefined && (LIMITED_TOKEN_ENDPOINTS.has(suffix) || PROVIDER_ROUTE.test(suffix))
  )
}

/**
 * Whether an agent-session request path is inside the token's scope: anything under the
 * conversation's own `/agent-sessions/:sessionId/teams/:teamId/` mount (MCP
 * endpoints, credential vending, kubeconfig exec-credential fetches), with or
 * without the mount prefix — the internal vend dispatch calls the sub-app
 * directly.
 */
export function scopedPathAllowed(
  path: string,
  claims: Pick<PreviewMcpClaims, 'sid' | 'tid' | 'lim'>,
) {
  const match = /^(?:\/agent-sessions)?\/([^/]+)\/teams\/([^/]+)\//u.exec(path)

  if (match === null || match[1] !== claims.sid || match[2] !== claims.tid) return false

  // An exchanged token is honored only where its credential limit applies.
  return !claims.lim || limitedTokenPathAllowed(path)
}

const SIGNED_TOKEN = /\beyJ[\w-]*\.[\w-]+\.[\w-]+/gu
const SKILLS_TOKEN = /\bnuphos-runtime-skills-v1\.[^\s"'\\]+/gu

/**
 * Replaces every token this backend signed (conversation, plan, skills) in
 * runtime output with a marker, so a token an agent prints never reaches the
 * transcript. Other JWTs are left alone. Safe on raw JSON: token characters
 * are never escaped.
 */
export function redactSignedTokens(text: string): string {
  return text
    .replace(SIGNED_TOKEN, (token) => (signedPayload(token) ? '[redacted]' : token))
    .replace(SKILLS_TOKEN, '[redacted]')
}

/** Claims when the token is a valid, unexpired preview-MCP token; else null. */
export function verifyPreviewMcpToken(token: string): PreviewMcpClaims | null {
  const payload = signedPayload(token)

  if (!payload) return null
  const claims = payload as PreviewMcpClaims

  if (Array.isArray(claims.aud) ? claims.aud[0] !== AUDIENCE : claims.aud !== AUDIENCE) return null
  if (claims.lim !== undefined && !validLimit(claims.lim)) return null
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

function validLimit(limit: unknown): limit is CredentialLimit {
  return (
    typeof limit === 'object' &&
    limit !== null &&
    !Array.isArray(limit) &&
    Object.values(limit).every(
      (ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
    )
  )
}

/**
 * The member whose Personal Credentials a conversation-token request uses: the
 * sender of a member's own turn, and the session owner for automated turns
 * (triggers, agent threads, resource events). Null for every other token, or
 * when the agent asks for the team identity (`identity=team`).
 */
export function personalCredentialSubject(
  authorization: string | undefined,
  identity?: string,
): string | null {
  if (identity === 'team') return null
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  const claims = token ? verifyPreviewMcpToken(token) : null

  // A member's own grant reaches every installation or workspace they can see,
  // so an exchanged token never uses it: it gets the team identity, which is
  // scoped to the one binding its limit was checked against.
  if (!claims || claims.lim) return null

  return claims.hum ? claims.sub : claims.own
}
