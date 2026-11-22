import { ObjectId } from 'mongodb'

import {
  accessView,
  bindingAccessUpdateSchema,
  bindingOwner,
  canEditAccess,
  canViewAccess,
  isPrivateAccess,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth/types'
import type { BindingAccess, TeamByosBindings } from '@/models'
import type { Context, Hono } from 'hono'
import type { Filter } from 'mongodb'

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
    // An older private list's one member stays its owner once it is shared,
    // and whoever makes an unowned binding private becomes its owner, so the
    // list never ends up with nobody able to change it.
    const input = c.req.valid('json')
    const existingOwner = current?.ownerUserId ?? bindingOwner(current)
    const becomesPrivate = isPrivateAccess(normalizeAccessInput(input, userId))
    const access = normalizeAccessInput(
      input,
      userId,
      new Date(),
      existingOwner ?? (becomesPrivate ? userId : undefined),
    )
    const teamId = parseObjectId(team.get('teamId'), 'teamId')
    const bindingId = typeof id === 'string' ? new ObjectId(id) : id
    // Saved only over the list this edit was allowed against, so a stale edit
    // can't undo a change made since, such as its owner making it private.
    const result = await teamByosBindings().updateOne(
      {
        _id: teamId,
        [collection]: {
          $elemMatch: { id: bindingId, 'access.updatedAt': current?.updatedAt ?? null },
        },
      } as Filter<TeamByosBindings>,
      { $set: { [`${collection}.$.access`]: access, updatedAt: access.updatedAt } },
    )

    if (result.matchedCount > 0) return c.json(accessView(access))
    if (await teamByosBindings().countDocuments({ _id: teamId, [`${collection}.id`]: bindingId })) {
      throw new AppError(
        409,
        'binding_access_changed',
        'Who may use this binding changed while this was being saved. Reload and try again.',
      )
    }
    throw new AppError(404, 'binding_not_found', 'This binding was disconnected')
  })
}
