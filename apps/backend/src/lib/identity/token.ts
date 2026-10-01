import { createHmac, timingSafeEqual } from 'node:crypto'

import { ObjectId as MongoObjectId } from 'mongodb'

import { config } from '@/config'

import type { ObjectId } from 'mongodb'

type NuphosSessionClaims = {
  aud: 'nuphos'
  sub: string
  iat: number
  exp: number
  from: 'nuphos'
  scope: 'all'
}

// Exported so server-initiated agent runs (trigger fires) can mint a token for
// the user instead of forwarding a Bearer token from an inbound request.
// ttlSec defaults to the normal session TTL; trigger fires should pass a short
// run-scoped value (≤ 28800) so the token expires well before the session would.
export function signNuphosToken(userId: ObjectId | string, ttlSec?: number): string {
  const secret = requireJwtSecret()
  const sub = typeof userId === 'string' ? userId : userId.toHexString()

  if (!MongoObjectId.isValid(sub)) {
    throw new Error(`Cannot sign Nuphos token: invalid user id ${sub}`)
  }
  const now = Math.floor(Date.now() / 1000)
  const claims: NuphosSessionClaims = {
    aud: 'nuphos',
    sub,
    iat: now,
    exp: now + (ttlSec ?? config.auth.sessionTtlSec),
    from: 'nuphos',
    scope: 'all',
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString(
    'base64url',
  )
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')

  return `${header}.${payload}.${signature}`
}

export function verifyNuphosToken(token: string): NuphosSessionClaims | null {
  const secret = config.auth.jwtSecret

  if (!secret) return null
  const parts = token.split('.')

  if (parts.length !== 3) return null
  const [header, payload, signature] = parts

  if (!header || !payload || !signature) return null
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')

  if (!safeEqual(expected, signature)) return null
  let claims: NuphosSessionClaims

  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as NuphosSessionClaims
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)

  if (claims.aud !== 'nuphos' || claims.from !== 'nuphos' || !claims.sub || claims.exp <= now)
    return null

  return claims
}

function requireJwtSecret(): string {
  if (!config.auth.jwtSecret) {
    throw new Error('NUPHOS_JWT_SECRET or JWT_SECRET_KEY is required for Nuphos auth')
  }

  return config.auth.jwtSecret
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  return left.length === right.length && timingSafeEqual(left, right)
}
