import { accessView, bindingAccessUpdateSchema, normalizeAccessInput } from '@/lib/byos/access'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerAwsAccessRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) => {
    return c.json(accessView(c.get('awsBinding').access))
  })

  accountScoped.put(
    '/access',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', bindingAccessUpdateSchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const roleId = c.get('awsBinding').id
      const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))

      await teamByosBindings().updateOne(
        { _id: teamId, 'awsRoles.id': roleId },
        {
          $set: {
            'awsRoles.$.access': access,
            updatedAt: access.updatedAt,
          },
        },
      )

      return c.json(accessView(access))
    },
  )

  accountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const roleId = c.get('awsBinding').id

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $pull: { awsRoles: { id: roleId } },
        $set: { updatedAt: new Date() },
      },
    )

    return c.body(null, 204)
  })
}
