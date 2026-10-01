import {
  getAccessTokenWithExpiry,
  LinearApiError,
  LinearReconnectRequired,
  linearGraphql,
  withLinearAccessToken,
} from '@/lib/byos/linear'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type { LinearWorkspaceVariables } from '@/middleware/auth'
import type { LinearWorkspaceBinding } from '@/models'
import type { Context } from 'hono'
import type { ObjectId } from 'mongodb'

export function linearReconnectError(): AppError {
  return new AppError(
    409,
    'linear_reconnect_required',
    'Linear authorization expired or was revoked. Reconnect the Linear workspace to continue.',
  )
}

export async function handOutLinearToken(
  teamId: ObjectId,
  binding: LinearWorkspaceBinding,
): Promise<{ token: string; expiresAt: Date | null }> {
  try {
    return await getAccessTokenWithExpiry(teamId, binding)
  } catch (error) {
    if (error instanceof LinearReconnectRequired) throw linearReconnectError()
    throw error
  }
}

export async function queryBindingGraphql<T>(
  c: Context<{ Variables: LinearWorkspaceVariables }>,
  query: string,
  variables: Record<string, unknown>,
  notFound?: AppError,
): Promise<T> {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('linearBinding')

  try {
    return await withLinearAccessToken(teamId, binding, (token) =>
      linearGraphql<T>(token, query, variables),
    )
  } catch (error) {
    if (error instanceof LinearReconnectRequired) throw linearReconnectError()
    if (error instanceof LinearApiError) {
      if (notFound && /entity not found/i.test(error.message)) throw notFound
      throw new AppError(502, 'linear_api_error', error.message)
    }
    throw error
  }
}

export function linearTeamUrl(organizationUrlKey: string | null | undefined, key: string) {
  return organizationUrlKey
    ? `https://linear.app/${encodeURIComponent(organizationUrlKey)}/team/${encodeURIComponent(key)}`
    : null
}
