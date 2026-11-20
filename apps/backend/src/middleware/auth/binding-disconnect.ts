import { canEditAccess } from '@/lib/byos/access'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import type { BindingCollection } from '@/lib/byos/access-routes'
import type { TeamAuthVariables } from '@/middleware/auth/types'
import type { BindingAccess } from '@/models'
import type { Context, MiddlewareHandler } from 'hono'
import type { ObjectId, UpdateResult } from 'mongodb'

/** The member list each disconnect was allowed against, until its write. */
const authorized = new WeakMap<Context, { access: BindingAccess | undefined }>()

/**
 * Only its owner may disconnect a private binding; an admin may disconnect a
 * shared one or one without an owner. Otherwise an admin could disconnect a
 * member's private cloud binding and connect the same role again as their own.
 */
export function allowDisconnect(c: Context, access: BindingAccess | undefined): void {
  const team = c as unknown as Context<{ Variables: TeamAuthVariables }>

  if (!canEditAccess(access, team.get('userId'), team.get('teamRole'))) {
    throw new AppError(
      403,
      'binding_private',
      "Only its owner can disconnect another member's private binding",
    )
  }
  authorized.set(c, { access })
}

/** `allowDisconnect` as a route middleware. */
export function requireCanDisconnect(
  /** The context key holding the binding (`…Binding`) or its member list (`…Access`). */
  key: string,
): MiddlewareHandler {
  return async (c, next) => {
    const value = (c as unknown as { get: (k: string) => unknown }).get(key)

    allowDisconnect(
      c,
      (key.endsWith('Binding')
        ? (value as { access?: BindingAccess } | undefined)?.access
        : value) as BindingAccess | undefined,
    )
    await next()
  }
}

/**
 * Removes the binding `match` names, only while its list is still the one
 * `allowDisconnect` allowed: an owner making it private in between wins.
 * A binding that is already gone matches nothing, for the route to answer.
 */
export async function disconnectBinding(
  c: Context,
  teamId: ObjectId,
  collection: BindingCollection,
  match: Record<string, unknown>,
): Promise<UpdateResult> {
  const allowed = authorized.get(c)

  if (!allowed) throw new Error('disconnectBinding needs allowDisconnect first')
  const result = await teamByosBindings().updateOne(
    {
      _id: teamId,
      [collection]: {
        $elemMatch: { ...match, 'access.updatedAt': allowed.access?.updatedAt ?? null },
      },
    },
    { $pull: { [collection]: match }, $set: { updatedAt: new Date() } },
  )

  if (
    result.matchedCount === 0 &&
    (await teamByosBindings().countDocuments({ _id: teamId, [collection]: { $elemMatch: match } }))
  ) {
    throw new AppError(
      409,
      'binding_access_changed',
      'Who may use this binding changed while you were disconnecting it. Reload and try again.',
    )
  }

  return result
}
