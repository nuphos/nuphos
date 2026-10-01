import { z } from 'zod'

import { config } from '@/config'
import { generateGkeKubeconfig, impersonateSa, listGkeClusters } from '@/lib/byos/gcp'
import { getGceInstanceSshAccess } from '@/lib/byos/gcp-compute'
import { getGcpIamPermissions } from '@/lib/byos/gcp-iam'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'

import { handleFor } from './handle'

import type { GcpProjectVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const gceSshAccessSchema = z.object({
  zone: z.string().trim().min(1),
})

export function registerGcpCredentialRoutes(
  projectScoped: Hono<{ Variables: GcpProjectVariables }>,
): void {
  projectScoped.post(
    '/gce-instances/:name/ssh-access',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', gceSshAccessSchema),
    async (c) => {
      const name = c.req.param('name')
      const { zone } = c.req.valid('json')
      const access = await getGceInstanceSshAccess(handleFor(c), zone, name)

      return c.json(access)
    },
  )

  projectScoped.get('/credentials', async (c) => {
    // Permission-admin SAs hold project IAM-write (escalation) power, so their
    // token must NEVER be exported here — not even to administrators. Admins edit
    // IAM only through the scoped grant/revoke endpoints below, which impersonate
    // the SA on the backend; the token itself never leaves. Handing it out would
    // put a self-escalation credential into any caller's hands — including the
    // agent sandbox, which authenticates as the (admin) user.
    if (c.get('gcpBinding').purpose === 'permission-admin') {
      throw new AppError(
        403,
        'permission_admin_no_token_export',
        'Credentials for a permission-admin service account cannot be exported; remove this retired connection and connect an ordinary service account instead',
      )
    }
    const handle = handleFor(c)
    const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
    const tokenResp = await impersonated.getAccessToken()

    if (!tokenResp.token) {
      throw new AppError(502, 'token_unavailable', 'Failed to mint impersonated access token')
    }
    const expiresAt = new Date(Date.now() + config.byos.gcp.tokenLifetimeSec * 1000)

    c.header('X-Credentials-Expires-At', expiresAt.toISOString())

    return c.json({
      accessToken: tokenResp.token,
      projectId: handle.projectId,
      serviceAccountEmail: handle.serviceAccountEmail,
      expiresAt: expiresAt.toISOString(),
    })
  })

  projectScoped.get('/clusters', async (c) => {
    const result = await listGkeClusters(handleFor(c))

    return c.json(result)
  })

  projectScoped.get('/iam-permissions', async (c) => {
    const result = await getGcpIamPermissions(handleFor(c))

    return c.json({ ...result, bindingWarnings: [] })
  })
}

export function registerGkeKubeconfigRoute(
  projectScoped: Hono<{ Variables: GcpProjectVariables }>,
): void {
  projectScoped.get('/clusters/:name/kubeconfig', async (c) => {
    const name = c.req.param('name')
    const handle = handleFor(c)
    let location = c.req.query('location') || c.req.query('region') || undefined

    if (!location) {
      const list = await listGkeClusters(handle)
      const found = list.clusters.find((cl) => cl.name === name)

      if (!found) {
        throw new AppError(404, 'cluster_not_found', `Cluster ${name} not found in this project`)
      }
      location = found.region
    }

    const result = await generateGkeKubeconfig(handle, location, name)

    if (!result) {
      throw new AppError(404, 'cluster_not_found', `Cluster ${name} not found in ${location}`)
    }

    c.header('Content-Type', 'application/yaml; charset=utf-8')
    c.header('X-Kubeconfig-Expires-At', result.expiresAt.toISOString())

    return c.body(result.kubeconfig)
  })
}
