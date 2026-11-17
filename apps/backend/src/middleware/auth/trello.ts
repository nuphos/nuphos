import { ObjectId } from 'mongodb'

import { findTrelloIntegration } from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { canRequestUseBinding } from '@/middleware/auth/binding-access'

import type { TrelloIntegrationVariables } from '@/middleware/auth/types'
import type { MiddlewareHandler } from 'hono'

export function requireTrelloIntegration(): MiddlewareHandler<{
  Variables: TrelloIntegrationVariables
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
    const binding = await findTrelloIntegration(teamId, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'trello_integration_not_bound',
        `Trello integration ${param} is not bound to this team`,
      )
    }
    c.set('trelloIntegrationId', param)
    c.set('trelloIntegrationLabel', binding.label)
    c.set('trelloAccess', binding.access)
    c.set('trelloBinding', binding)
    await next()
  }
}

export function requireTrelloMemberAccess(): MiddlewareHandler<{
  Variables: TrelloIntegrationVariables
}> {
  return async (c, next) => {
    const access = c.get('trelloAccess')
    // Unlike other bindings, a Trello binding without a list is closed.
    const closed = { updatedAt: new Date(0), updatedBy: '', ...access }

    if (!canRequestUseBinding(c, { ...closed, memberAllowList: access?.memberAllowList ?? [] })) {
      throw new AppError(
        403,
        'trello_integration_access_denied',
        'You are not allowed to use this Trello integration binding',
      )
    }
    await next()
  }
}
