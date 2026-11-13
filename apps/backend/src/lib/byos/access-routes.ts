import { ObjectId } from 'mongodb'

import {
  accessView,
  bindingAccessUpdateSchema,
  canUseAllowList,
  isPrivateAccess,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth/core'
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

/**
 * GET/PUT of a binding's member list, admin only. Register it before the
 * binding's member gate, so an admin who is not on the list can manage it.
 * A member's private binding stays theirs: an admin can see it, not share it.
 */
export function registerBindingAccessRoutes<V extends TeamAuthVariables>(
  scoped: Hono<{ Variables: V }>,
  collection: BindingCollection,
  bindingOf: (c: Context<{ Variables: V }>) => BindingRef | Promise<BindingRef>,
  path = '/access',
): void {
  scoped.get(path, requireTeamRole('ADMINISTRATOR'), async (c) =>
    c.json(accessView((await bindingOf(c as never)).access)),
  )

  scoped.put(
    path,
    requireTeamRole('ADMINISTRATOR'),
    zv('json', bindingAccessUpdateSchema),
    async (c) => {
      const { id, access: current } = await bindingOf(c as never)
      const userId = c.get('userId')

      if (isPrivateAccess(current) && !canUseAllowList(current?.memberAllowList, userId)) {
        throw new AppError(
          403,
          'binding_private',
          "Only its owner can share another member's private binding",
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
          _id: parseObjectId(c.get('teamId'), 'teamId'),
          [`${collection}.id`]: typeof id === 'string' ? new ObjectId(id) : id,
        },
        { $set: { [`${collection}.$.access`]: access, updatedAt: access.updatedAt } },
      )

      if (result.matchedCount === 0) {
        throw new AppError(404, 'binding_not_found', 'This binding was disconnected')
      }

      return c.json(accessView(access))
    },
  )
}
