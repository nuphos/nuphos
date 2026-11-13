import { ObjectId } from 'mongodb'

import {
  accessView,
  bindingAccessUpdateSchema,
  canEditAccess,
  canViewAccess,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth/types'
import type { BindingAccess, TeamByosBindings } from '@/models'
import type { Context, Hono } from 'hono'

/** The team document arrays whose bindings carry an `id` and a member list. */
export type BindingCollection = {
  [K in keyof TeamByosBindings]-?: NonNullable<TeamByosBindings[K]> extends readonly {
    id: ObjectId
    access?: BindingAccess
  }[]
    ? K
    : never
}[keyof TeamByosBindings]

type BindingRef = { id: ObjectId | string; access?: BindingAccess }

/** The team route variables every scoped router carries. */
const teamOf = (c: Context) => c as unknown as Context<{ Variables: TeamAuthVariables }>

/**
 * GET/PUT of a binding's member list, for admins and the binding's owner.
 * Register it before the binding's member gate, so they can manage it while
 * off the list. A member's private binding stays theirs: an admin can see it,
 * not share it.
 */
export function registerBindingAccessRoutes<V extends TeamAuthVariables>(
  scoped: Hono<{ Variables: V }>,
  collection: BindingCollection,
  bindingOf: (c: Context<{ Variables: V }>) => BindingRef | Promise<BindingRef>,
  path = '/access',
): void {
  scoped.get(path, async (c) => {
    const { access } = await bindingOf(c as never)
    const team = teamOf(c)

    if (!canViewAccess(access, team.get('userId'), team.get('teamRole'))) {
      throw new AppError(
        403,
        'forbidden',
        "Only admins and the binding's owner can see its members",
      )
    }

    return c.json(accessView(access))
  })

  scoped.put(path, zv('json', bindingAccessUpdateSchema), async (c) => {
    const { id, access: current } = await bindingOf(c as never)
    const team = teamOf(c)
    const userId = team.get('userId')

    if (!canEditAccess(current, userId, team.get('teamRole'))) {
      throw new AppError(
        403,
        'binding_private',
        "Only its owner can change who may use another member's private binding",
      )
    }
    const access = normalizeAccessInput(
      c.req.valid('json'),
      userId,
      new Date(),
      current?.ownerUserId,
    )
    const result = await teamByosBindings().updateOne(
      {
        _id: parseObjectId(team.get('teamId'), 'teamId'),
        [`${collection}.id`]: typeof id === 'string' ? new ObjectId(id) : id,
      },
      { $set: { [`${collection}.$.access`]: access, updatedAt: access.updatedAt } },
    )

    if (result.matchedCount === 0) {
      throw new AppError(404, 'binding_not_found', 'This binding was disconnected')
    }

    return c.json(accessView(access))
  })
}
