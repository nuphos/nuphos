import { ObjectId } from 'mongodb'

import type { NuphosTeamRole } from '@/lib/identity'
import type { AuthVariables, TeamAuthVariables } from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

import { AppError } from '@/lib/errors'
import { authenticateToken, getTeamMembership } from '@/lib/identity'
import { AI_CONSENT_VERSION, readAIConsent } from '@/lib/identity/ai-consent'

export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const header = c.req.header('Authorization')

  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'unauthorized', 'Missing Bearer token')
  }
  const token = header.slice('Bearer '.length)

  const result = await authenticateToken(token)

  if (!result) {
    throw new AppError(401, 'unauthorized', 'Invalid or expired token')
  }

  const { user } = result

  if (!ObjectId.isValid(user.id)) {
    throw new AppError(500, 'invalid_user_id', 'Nuphos returned a non-ObjectId user id')
  }

  const consentVersion = c.req.header('x-nuphos-ai-consent-version')

  if (
    consentVersion &&
    !c.req.path.startsWith('/auth/') &&
    !c.req.path.startsWith('/push/devices') &&
    !/\/(abort|cancel|cancel-runtime)$/.test(c.req.path)
  ) {
    if (consentVersion !== AI_CONSENT_VERSION || !(await readAIConsent(user.id)).accepted) {
      throw new AppError(
        403,
        'ai_consent_required',
        'Review and accept the current AI data sharing notice in the app before using AI features',
      )
    }
  }

  c.set('userId', user.id)
  c.set('userEmail', user.email)
  c.set('userName', user.name)
  c.set('user', user)
  c.set('authToken', token)
  await next()
}

export function requireTeamMember(): MiddlewareHandler<{ Variables: TeamAuthVariables }> {
  return async (c, next) => {
    const userId = c.get('userId')
    const teamIdParam = c.req.param('teamId')

    if (!teamIdParam) throw new AppError(400, 'invalid_request', 'Missing teamId param')
    if (!ObjectId.isValid(teamIdParam)) {
      throw new AppError(400, 'invalid_id', `Invalid teamId: ${teamIdParam}`)
    }

    const membership = await getTeamMembership(userId, teamIdParam)

    if (!membership) {
      throw new AppError(403, 'forbidden', 'You are not a member of this team')
    }

    c.set('teamId', teamIdParam)
    c.set('teamRole', membership.role)
    c.set('team', membership.team)
    await next()
  }
}

export function requireTeamRole(
  ...allowed: NuphosTeamRole[]
): MiddlewareHandler<{ Variables: TeamAuthVariables }> {
  return async (c, next) => {
    const role = c.get('teamRole')

    if (!allowed.includes(role)) {
      throw new AppError(403, 'forbidden', `Requires one of: ${allowed.join(', ')}`)
    }
    await next()
  }
}
