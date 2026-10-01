import { Hono } from 'hono'

import {
  accessView,
  bindingAccessUpdateSchema,
  canUseAllowList,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { tencentHandleFor } from '@/lib/byos/handles'
import { listTkeClusters, generateTkeKubeconfig, tencentBootstrapRegion } from '@/lib/byos/tencent'
import { listCvmInstances } from '@/lib/byos/tencent-cvm'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { TencentAccountBinding } from '@/models'
import type { MiddlewareHandler } from 'hono'

type TencentAccountVariables = TeamAuthVariables & {
  tencentBinding: TencentAccountBinding
}

/**
 * Resolve the `:accountId` binding and pin it on ctx. Deliberately does NOT
 * assume the role: admin repair routes (DELETE, access) must keep working even
 * when the OIDC connector is unconfigured. Routes that actually call TKE assume
 * the role lazily via `tencentHandleFor`.
 */
function requireTencentAccount(): MiddlewareHandler<{ Variables: TencentAccountVariables }> {
  return async (c, next) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountIdParam = c.req.param('accountId')

    if (!accountIdParam) throw new AppError(400, 'invalid_request', 'Missing accountId param')
    const accountId = parseObjectId(accountIdParam, 'accountId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { tencentAccounts: 1 } },
    )
    const binding = (doc?.tencentAccounts ?? []).find((b) => b.id.equals(accountId))

    if (!binding) {
      throw new AppError(404, 'tencent_account_not_found', 'Tencent account binding not found')
    }
    c.set('tencentBinding', binding)
    await next()
  }
}

export const tencentAccountScoped = new Hono<{ Variables: TencentAccountVariables }>()

tencentAccountScoped.use('*', requireTencentAccount())

tencentAccountScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('tencentBinding').access)),
)

tencentAccountScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = c.get('tencentBinding').id
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'tencentAccounts.id': accountId },
      { $set: { 'tencentAccounts.$.access': access, updatedAt: access.updatedAt } },
    )

    // Guard the concurrent-delete race: if the binding was removed between the
    // middleware fetch and this write, don't report success for a no-op.
    if (res.matchedCount === 0) {
      throw new AppError(
        404,
        'tencent_account_not_found',
        'Tencent Cloud account binding not found',
      )
    }

    return c.json(accessView(access))
  },
)

tencentAccountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = c.get('tencentBinding').id

  await teamByosBindings().updateOne(
    { _id: teamId },
    { $pull: { tencentAccounts: { id: accountId } }, $set: { updatedAt: new Date() } },
  )

  return c.body(null, 204)
})

// Below: any team member with allow-list access to this binding.
tencentAccountScoped.use('*', async (c, next) => {
  if (
    c.get('teamRole') !== 'ADMINISTRATOR' &&
    !canUseAllowList(c.get('tencentBinding').access?.memberAllowList, c.get('userId'))
  ) {
    throw new AppError(403, 'forbidden', 'You do not have access to this Tencent binding')
  }
  await next()
})

tencentAccountScoped.get('/', (c) => {
  const b = c.get('tencentBinding')

  return c.json({
    accountId: b.id.toHexString(),
    label: b.label,
    site: b.site ?? 'china',
    roleArn: b.roleArn,
  })
})

// The team's own short-lived STS credentials for the sandbox/agent (tccli) —
// gated by the binding's member allow-list above. Assumes the role fresh; the
// token accompanies the temporary secretId/secretKey. `defaultRegion` lets the
// CLI setup pick a region the credentials authenticate against.
tencentAccountScoped.get('/credentials', async (c) => {
  const handle = await tencentHandleFor(c.get('tencentBinding'), c.get('teamId'))

  // Reusable secret — never cache in clients or intermediaries.
  c.header('Cache-Control', 'no-store')

  return c.json({
    secretId: handle.secretId,
    secretKey: handle.secretKey,
    token: handle.token,
    site: handle.site,
    defaultRegion: tencentBootstrapRegion(handle.site),
  })
})

tencentAccountScoped.get('/clusters', async (c) => {
  const result = await listTkeClusters(
    await tencentHandleFor(c.get('tencentBinding'), c.get('teamId')),
  )

  return c.json(result)
})

// CVM (Cloud Virtual Machine) servers — read-only list, mirroring AWS EC2.
tencentAccountScoped.get('/cvm-instances', async (c) => {
  const result = await listCvmInstances(
    await tencentHandleFor(c.get('tencentBinding'), c.get('teamId')),
  )

  return c.json(result)
})

// `:clusterId` is the TKE cluster id (cls-xxxx).
tencentAccountScoped.get('/clusters/:clusterId/kubeconfig', async (c) => {
  const clusterId = c.req.param('clusterId')
  const handle = await tencentHandleFor(c.get('tencentBinding'), c.get('teamId'))
  let region = c.req.query('region') || undefined

  if (!region) {
    const list = await listTkeClusters(handle)
    const found = list.clusters.find((cl) => cl.tencentClusterId === clusterId)

    if (!found) {
      throw new AppError(404, 'cluster_not_found', `Cluster ${clusterId} not found in this account`)
    }
    region = found.region
  }

  const result = await generateTkeKubeconfig(handle, region, clusterId)

  if (!result) {
    throw new AppError(404, 'cluster_not_found', `Cluster ${clusterId} not found in ${region}`)
  }

  // Kubeconfig embeds credentials — never cache.
  c.header('Cache-Control', 'no-store')
  c.header('Content-Type', 'application/yaml; charset=utf-8')
  c.header('X-Kubeconfig-Expires-At', result.expiresAt.toISOString())

  return c.body(result.kubeconfig)
})
