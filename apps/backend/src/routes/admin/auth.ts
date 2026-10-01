import { config } from '@/config'
import { collectCookieTokenCandidates } from '@/lib/cookie-auth'
import { AppError } from '@/lib/errors'
import { authenticateToken, getTeamMembership } from '@/lib/identity'

import type { NuphosUser } from '@/lib/identity'
import type { MiddlewareHandler } from 'hono'

export type AdminVars = {
  adminAuthSource: 'nuphos-token'
  adminUserId?: string
}

export const requireAdmin: MiddlewareHandler<{ Variables: AdminVars }> = async (c, next) => {
  const cookieAuth = await authenticateCookieAdmin(c.req.header('Cookie'))

  if (cookieAuth.status === 'ok') {
    c.set('adminAuthSource', 'nuphos-token')
    c.set('adminUserId', cookieAuth.user.id)
    await next()

    return
  }
  if (cookieAuth.status === 'not-admin') {
    throw new AppError(403, 'forbidden', `Nuphos user ${cookieAuth.user.id} is not an Nuphos admin`)
  }
  throw new AppError(401, 'unauthorized', 'Missing Nuphos token')
}

type CookieAdminAuthResult =
  | { status: 'ok'; user: NuphosUser }
  | { status: 'missing' }
  | { status: 'not-admin'; user: NuphosUser }

async function authenticateCookieAdmin(
  cookieHeader: string | undefined,
): Promise<CookieAdminAuthResult> {
  let authenticatedUser: NuphosUser | null = null

  for (const token of collectCookieTokenCandidates(cookieHeader, config.admin.cookieNames)) {
    const result = await authenticateToken(token)

    if (!result) continue
    authenticatedUser = result.user
    if (await isAdminUser(result.user.id)) {
      return { status: 'ok', user: result.user }
    }
  }

  return authenticatedUser
    ? { status: 'not-admin', user: authenticatedUser }
    : { status: 'missing' }
}

// Admin = member of the admin team (config.admin.teamId, Zeabur Inc.).
// Membership is cached in-memory so the check doesn't add a Mongo query to
// every admin request; a revoked member keeps access for at most the TTL.
const ADMIN_MEMBERSHIP_TTL_MS = 5 * 60_000
const ADMIN_MEMBERSHIP_CACHE_MAX = 1000
const adminMembershipCache = new Map<string, { isAdmin: boolean; expiresAt: number }>()

async function isAdminUser(userId: string): Promise<boolean> {
  const now = Date.now()
  const cached = adminMembershipCache.get(userId)

  if (cached && cached.expiresAt > now) return cached.isAdmin
  const membership = await getTeamMembership(userId, config.admin.teamId)
  const isAdmin = membership !== null

  if (adminMembershipCache.size >= ADMIN_MEMBERSHIP_CACHE_MAX) {
    const oldest = adminMembershipCache.keys().next().value

    if (oldest !== undefined) adminMembershipCache.delete(oldest)
  }
  adminMembershipCache.set(userId, { isAdmin, expiresAt: now + ADMIN_MEMBERSHIP_TTL_MS })

  return isAdmin
}
