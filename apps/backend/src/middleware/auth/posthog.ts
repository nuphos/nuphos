import { ObjectId } from 'mongodb'

import { canUseAllowList } from '@/lib/byos/access'
import { findPosthogIntegration } from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type { PosthogIntegrationVariables } from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

export function requirePosthogIntegration(): MiddlewareHandler<{
  Variables: PosthogIntegrationVariables
}> {
  return async (c, next) => {
    const param = c.req.param('integrationId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(
        400,
        'invalid_integration_id',
        'integrationId must be a 24-character hex ObjectId',
      )
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const binding = await findPosthogIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'posthog_integration_not_bound',
        `PostHog integration ${param} is not bound to this team`,
      )
    }
    c.set('posthogIntegrationId', param)
    c.set('posthogAccess', binding.access)
    c.set('posthogBinding', binding)
    await next()
  }
}

export function requirePosthogMemberAccess(): MiddlewareHandler<{
  Variables: PosthogIntegrationVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('posthogAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'posthog_integration_access_denied',
        'You are not allowed to use this PostHog integration binding',
      )
    }
    await next()
  }
}
