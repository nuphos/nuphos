import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { runtimeBackendUrl } from './runtime-backend-url'

const PREFIX = 'nuphos-runtime-skills-v1'

export function runtimeSkillsUrl(teamId: string, external?: boolean, backendUrl?: string): string {
  const base = backendUrl ?? runtimeBackendUrl(external)

  if (!base) throw new Error('No backend URL this runtime can reach is configured for skill sync')

  return `${base.replace(/\/$/, '')}/internal/claude-code-runtime-skills/${teamId}`
}

function secret(): string {
  const value = config.auth.jwtSecret

  if (!value) throw new AppError(503, 'jwt_secret_unavailable', 'NUPHOS_JWT_SECRET is required')

  return value
}

// A runtime is handed a fresh mint on every session and prompt, so nothing
// holds one long enough for the lifetime to be felt.
const LIFETIME_MS = 24 * 60 * 60 * 1000

function signature(encodedSubject: string, expiresAt: string): string {
  return createHmac('sha256', secret())
    .update(`${PREFIX}.${encodedSubject}.${expiresAt}`)
    .digest('base64url')
}

export type RuntimeSkillsClaims = { teamId: string; userId?: string }

/**
 * Narrow, expiring credential for a runtime's skill sync. It always names the
 * team; naming the turn's actor as well lets it fetch that member's personal
 * skills, and nobody else's.
 */
export function mintRuntimeSkillsToken(teamId: string, userId?: string, now = Date.now()): string {
  const subject = userId ? `${teamId}:${userId}` : teamId
  const encodedSubject = Buffer.from(subject, 'utf8').toString('base64url')
  const expiresAt = String(now + LIFETIME_MS)

  return `${PREFIX}.${encodedSubject}.${expiresAt}.${signature(encodedSubject, expiresAt)}`
}

export function verifyRuntimeSkillsToken(
  token: string,
  now = Date.now(),
): RuntimeSkillsClaims | null {
  const [prefix, encodedSubject, expiresAt, supplied] = token.split('.')

  if (prefix !== PREFIX || !encodedSubject || !expiresAt || !supplied) return null
  const expected = Buffer.from(signature(encodedSubject, expiresAt))
  const actual = Buffer.from(supplied)

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  if (!/^\d+$/u.test(expiresAt) || Number(expiresAt) <= now) return null
  const [teamId, userId] = Buffer.from(encodedSubject, 'base64url').toString('utf8').split(':')

  if (!teamId) return null

  return userId ? { teamId, userId } : { teamId }
}
