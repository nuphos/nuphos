// Token minting/verification and PKCE for the Nuphos MCP OAuth server.
//
// Access tokens are self-contained HS256 JWTs (same primitive as the Nuphos
// session token) audience-bound to the MCP resource. Authorization codes and
// refresh tokens are opaque random strings; only their SHA-256 hashes are
// stored, so a DB read never yields a usable credential.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'

import { MCP_SCOPE } from './metadata'

function jwtSecret(): string {
  const secret = config.auth.jwtSecret

  if (!secret) throw new Error('NUPHOS_JWT_SECRET / JWT_SECRET_KEY is required to issue MCP tokens')

  return secret
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)

  if (ab.length !== bb.length) return false

  return timingSafeEqual(ab, bb)
}

// ─── Opaque tokens (auth codes, refresh tokens) ─────────────────────────────

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

// Stored as the collection _id so lookups are indexed and single-use deletes
// are trivial. SHA-256 is fine here: the input is already 256 bits of entropy.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

// ─── PKCE (RFC 7636, S256 only) ─────────────────────────────────────────────

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  // RFC 7636: verifier is 43-128 unreserved chars; an S256 challenge is the
  // base64url SHA-256 digest, always exactly 43 chars.
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) return false
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return false
  const computed = createHash('sha256').update(codeVerifier).digest('base64url')

  return safeEqualStr(computed, codeChallenge)
}

// ─── Consent token (CSRF guard for cookie-based one-click authorize) ────────
//
// When /oauth/authorize authenticates the user from a browser cookie, the
// consent POST is protected by a short-lived HMAC token bound to that user and
// client. A cross-site attacker can trigger the POST (the cookie rides along)
// but cannot read the consent page to obtain this token.

type ConsentClaims = {
  sub: string
  client_id: string
  exp: number
  from: 'mcp-consent'
}

export function signConsentToken(params: {
  userId: string
  clientId: string
  ttlSec: number
}): string {
  const claims: ConsentClaims = {
    sub: params.userId,
    client_id: params.clientId,
    exp: Math.floor(Date.now() / 1000) + params.ttlSec,
    from: 'mcp-consent',
  }
  const payload = b64url(JSON.stringify(claims))
  const signature = createHmac('sha256', jwtSecret()).update(payload).digest('base64url')

  return `${payload}.${signature}`
}

export function verifyConsentToken(token: string, userId: string, clientId: string): boolean {
  const parts = token.split('.')

  if (parts.length !== 2) return false
  const [payload, signature] = parts

  if (!payload || !signature) return false

  const expected = createHmac('sha256', jwtSecret()).update(payload).digest('base64url')

  if (!safeEqualStr(expected, signature)) return false

  let claims: ConsentClaims

  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConsentClaims
  } catch {
    return false
  }

  if (claims.from !== 'mcp-consent') return false
  if (claims.sub !== userId) return false
  if (claims.client_id !== clientId) return false
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return false

  return true
}

// ─── Access token (HS256 JWT, audience = MCP resource) ──────────────────────

export type McpAccessClaims = {
  iss: string
  sub: string // Nuphos user id
  aud: string // MCP resource URL
  scope: string
  client_id: string
  iat: number
  exp: number
  from: 'mcp'
}

export function signAccessToken(params: {
  userId: string
  clientId: string
  resource: string
  issuer: string
  scope?: string
  ttlSec: number
}): string {
  const now = Math.floor(Date.now() / 1000)
  const claims: McpAccessClaims = {
    iss: params.issuer,
    sub: params.userId,
    aud: params.resource,
    scope: params.scope ?? MCP_SCOPE,
    client_id: params.clientId,
    iat: now,
    exp: now + params.ttlSec,
    from: 'mcp',
  }
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  const signature = createHmac('sha256', jwtSecret())
    .update(`${header}.${payload}`)
    .digest('base64url')

  return `${header}.${payload}.${signature}`
}

// Returns the claims if the token is a valid, unexpired MCP access token whose
// issuer and audience match this server/resource and whose scope includes
// `mcp`; else null.
export function verifyAccessToken(
  token: string,
  resource: string,
  issuer: string,
): McpAccessClaims | null {
  const parts = token.split('.')

  if (parts.length !== 3) return null
  const [header, payload, signature] = parts

  if (!header || !payload || !signature) return null

  try {
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: string
      typ?: string
    }

    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') return null
  } catch {
    return null
  }

  const expected = createHmac('sha256', jwtSecret())
    .update(`${header}.${payload}`)
    .digest('base64url')

  if (!safeEqualStr(expected, signature)) return null

  let claims: McpAccessClaims

  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as McpAccessClaims
  } catch {
    return null
  }

  if (claims.from !== 'mcp') return null
  if (claims.iss !== issuer) return null
  if (claims.aud !== resource) return null
  if (!(claims.scope ?? '').split(' ').includes(MCP_SCOPE)) return null
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null
  if (!claims.sub) return null

  return claims
}
