import { Hono } from 'hono'

import { registerBindingAccessRoutes } from '@/lib/byos/access-routes'
import { parseObjectId } from '@/lib/objectid'
import { requireGcpMemberAccess, requireGcpProject, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import { registerGcpCloudRunRoutes } from './cloud-run'
import { registerGcpComputeRoutes } from './compute'
import { firebaseRoutes } from './firebase'
import { registerGcpCredentialRoutes, registerGkeKubeconfigRoute } from './credentials'
import { registerGcpMonitoringRoutes } from './monitoring'

import type { GcpProjectVariables } from '@/middleware/auth'

export const gcpProjectScoped = new Hono<{ Variables: GcpProjectVariables }>()

gcpProjectScoped.use('*', requireGcpProject())

registerBindingAccessRoutes(gcpProjectScoped, 'gcpServiceAccounts', (c) => c.get('gcpBinding'))

gcpProjectScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const serviceAccountId = c.get('gcpBinding').id

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { gcpServiceAccounts: { id: serviceAccountId } },
      $set: { updatedAt: new Date() },
    },
  )

  return c.body(null, 204)
})

gcpProjectScoped.use('*', requireGcpMemberAccess())

gcpProjectScoped.get('/', (c) => {
  return c.json({
    serviceAccountId: c.get('gcpBinding').id.toHexString(),
    projectId: c.get('projectId'),
    serviceAccountEmail: c.get('serviceAccountEmail'),
  })
})

registerGcpComputeRoutes(gcpProjectScoped)
registerGcpMonitoringRoutes(gcpProjectScoped)
registerGcpCredentialRoutes(gcpProjectScoped)
registerGkeKubeconfigRoute(gcpProjectScoped)
registerGcpCloudRunRoutes(gcpProjectScoped)
gcpProjectScoped.route('/firebase', firebaseRoutes)
