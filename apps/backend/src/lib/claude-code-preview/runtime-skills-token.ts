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

function signature(encodedTeamId: string, expiresAt: string): string {
  return createHmac('sha256', secret())
    .update(`${PREFIX}.${encodedTeamId}.${expiresAt}`)
    .digest('base64url')
}

/** Narrow, team-scoped, expiring credential for a runtime's skill sync. */
export function mintRuntimeSkillsToken(teamId: string, now = Date.now()): string {
  const encodedTeamId = Buffer.from(teamId, 'utf8').toString('base64url')
  const expiresAt = String(now + LIFETIME_MS)

  return `${PREFIX}.${encodedTeamId}.${expiresAt}.${signature(encodedTeamId, expiresAt)}`
}

export function verifyRuntimeSkillsToken(token: string, now = Date.now()): string | null {
  const [prefix, encodedTeamId, expiresAt, supplied] = token.split('.')

  if (prefix !== PREFIX || !encodedTeamId || !expiresAt || !supplied) return null
  const expected = Buffer.from(signature(encodedTeamId, expiresAt))
  const actual = Buffer.from(supplied)

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  if (!/^\d+$/u.test(expiresAt) || Number(expiresAt) <= now) return null
  try {
    const teamId = Buffer.from(encodedTeamId, 'base64url').toString('utf8')

    return teamId || null
  } catch {
    return null
  }
}
