import { Hono } from 'hono'

import { registerBindingAccessRoutes } from '@/lib/byos/access-routes'
import { parseObjectId } from '@/lib/objectid'
import {
  disconnectBinding,
  requireCanDisconnect,
  requireGcpMemberAccess,
  requireGcpProject,
  requireTeamRole,
} from '@/middleware/auth'
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

gcpProjectScoped.delete(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  requireCanDisconnect('gcpBinding'),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const serviceAccountId = c.get('gcpBinding').id

    await disconnectBinding(c, teamId, 'gcpServiceAccounts', { id: serviceAccountId })

    return c.body(null, 204)
  },
)

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
