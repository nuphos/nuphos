import { createHmac, timingSafeEqual } from 'node:crypto'

import { ObjectId as MongoObjectId } from 'mongodb'

import { config } from '@/config'

import type { ObjectId } from 'mongodb'

type NuphosRunClaims = {
  aud: 'nuphos'
  sub: string
  iat: number
  exp: number
  from: 'nuphos'
  scope: 'all'
}

/**
 * Short-lived token the backend hands an agent run so it can act for its user.
 * Sign-ins never get one; they get a revocable session (`sessions.ts`).
 */
export const MAX_RUN_TOKEN_TTL_SEC = 24 * 60 * 60

/**
 * Sign-in JWTs issued before sessions existed lived 30 days. They are accepted
 * until they expire on their own; anything signed for longer is refused. Once
 * the last of them has expired, verify against MAX_RUN_TOKEN_TTL_SEC instead.
 * To end them all sooner, rotate NUPHOS_JWT_SECRET.
 */
const LEGACY_SIGN_IN_TTL_SEC = 30 * 24 * 60 * 60

export function signNuphosToken(userId: ObjectId | string, ttlSec: number): string {
  const secret = requireJwtSecret()
  const sub = typeof userId === 'string' ? userId : userId.toHexString()

  if (!MongoObjectId.isValid(sub)) {
    throw new Error(`Cannot sign Nuphos token: invalid user id ${sub}`)
  }
  if (!(ttlSec > 0 && ttlSec <= MAX_RUN_TOKEN_TTL_SEC)) {
    throw new Error(`Cannot sign Nuphos token: ttl ${String(ttlSec)}s is out of range`)
  }
  const now = Math.floor(Date.now() / 1000)
  const claims: NuphosRunClaims = {
    aud: 'nuphos',
    sub,
    iat: now,
    exp: now + ttlSec,
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

export function verifyNuphosToken(token: string): NuphosRunClaims | null {
  const secret = config.auth.jwtSecret

  if (!secret) return null
  const parts = token.split('.')

  if (parts.length !== 3) return null
  const [header, payload, signature] = parts

  if (!header || !payload || !signature) return null
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')

  if (!safeEqual(expected, signature)) return null
  let claims: NuphosRunClaims

  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as NuphosRunClaims
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)

  if (
    claims.aud !== 'nuphos' ||
    claims.from !== 'nuphos' ||
    !claims.sub ||
    claims.exp <= now ||
    claims.exp - claims.iat > LEGACY_SIGN_IN_TTL_SEC
  )
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
