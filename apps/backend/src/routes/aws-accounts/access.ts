import { registerBindingAccessRoutes } from '@/lib/byos/access-routes'
import { parseObjectId } from '@/lib/objectid'
import { disconnectBinding, requireCanDisconnect, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerAwsAccessRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  registerBindingAccessRoutes(accountScoped, 'awsRoles', (c) => c.get('awsBinding'))

  accountScoped.delete(
    '/',
    requireTeamRole('ADMINISTRATOR'),
    requireCanDisconnect('awsBinding'),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const roleId = c.get('awsBinding').id

      await disconnectBinding(c, teamId, 'awsRoles', { id: roleId })

      return c.body(null, 204)
    },
  )
}
