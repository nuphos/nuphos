import { Hono } from 'hono'

import {
  accessView,
  bindingAccessUpdateSchema,
  canUseAllowList,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { listAckClusters, generateAckKubeconfig, aliyunBootstrapRegion } from '@/lib/byos/aliyun'
import { listEcsInstances } from '@/lib/byos/aliyun-ecs'
import { listSwasInstances } from '@/lib/byos/aliyun-swas'
import { aliyunHandleFor } from '@/lib/byos/handles'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { AliyunAccountBinding } from '@/models'
import type { MiddlewareHandler } from 'hono'

type AliyunAccountVariables = TeamAuthVariables & {
  aliyunBinding: AliyunAccountBinding
}

/**
 * Resolve the `:accountId` binding and pin it on ctx. Deliberately does NOT
 * assume the role: admin repair routes (DELETE, access) must keep working even
 * when the OIDC connector is unconfigured. Routes that call ACK/ECS assume the
 * role lazily via `aliyunHandleFor`.
 */
function requireAliyunAccount(): MiddlewareHandler<{ Variables: AliyunAccountVariables }> {
  return async (c, next) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountIdParam = c.req.param('accountId')

    if (!accountIdParam) throw new AppError(400, 'invalid_request', 'Missing accountId param')
    const accountId = parseObjectId(accountIdParam, 'accountId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { aliyunAccounts: 1 } },
    )
    const binding = (doc?.aliyunAccounts ?? []).find((b) => b.id.equals(accountId))

    if (!binding) {
      throw new AppError(404, 'aliyun_account_not_found', 'Alibaba Cloud account binding not found')
    }
    c.set('aliyunBinding', binding)
    await next()
  }
}

export const aliyunAccountScoped = new Hono<{ Variables: AliyunAccountVariables }>()

aliyunAccountScoped.use('*', requireAliyunAccount())

aliyunAccountScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('aliyunBinding').access)),
)

aliyunAccountScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = c.get('aliyunBinding').id
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'aliyunAccounts.id': accountId },
      { $set: { 'aliyunAccounts.$.access': access, updatedAt: access.updatedAt } },
    )

    // Guard the concurrent-delete race: if the binding was removed between the
    // middleware fetch and this write, don't report success for a no-op.
    if (res.matchedCount === 0) {
      throw new AppError(404, 'aliyun_account_not_found', 'Alibaba Cloud account binding not found')
    }

    return c.json(accessView(access))
  },
)

aliyunAccountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = c.get('aliyunBinding').id

  await teamByosBindings().updateOne(
    { _id: teamId },
    { $pull: { aliyunAccounts: { id: accountId } }, $set: { updatedAt: new Date() } },
  )

  return c.body(null, 204)
})

// Below: any team member with allow-list access to this binding.
aliyunAccountScoped.use('*', async (c, next) => {
  if (
    c.get('teamRole') !== 'ADMINISTRATOR' &&
    !canUseAllowList(c.get('aliyunBinding').access?.memberAllowList, c.get('userId'))
  ) {
    throw new AppError(403, 'forbidden', 'You do not have access to this Alibaba Cloud binding')
  }
  await next()
})

aliyunAccountScoped.get('/', (c) => {
  const b = c.get('aliyunBinding')

  return c.json({
    accountId: b.id.toHexString(),
    label: b.label,
    site: b.site ?? 'china',
    roleArn: b.roleArn,
  })
})

// The team's own short-lived STS credentials for the sandbox/agent (aliyun CLI)
// — gated by the binding's member allow-list above. Assumes the role fresh; the
// securityToken accompanies the temporary AccessKeyId/Secret. `defaultRegion`
// lets the CLI setup pick a region the credentials authenticate against.
aliyunAccountScoped.get('/credentials', async (c) => {
  const handle = await aliyunHandleFor(c.get('aliyunBinding'), c.get('teamId'))

  // Reusable secret — never cache in clients or intermediaries.
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessKeyId: handle.accessKeyId,
    accessKeySecret: handle.accessKeySecret,
    securityToken: handle.securityToken,
    site: handle.site,
    defaultRegion: aliyunBootstrapRegion(handle.site),
  })
})

aliyunAccountScoped.get('/clusters', async (c) => {
  const result = await listAckClusters(
    await aliyunHandleFor(c.get('aliyunBinding'), c.get('teamId')),
  )

  return c.json(result)
})

// ECS (Elastic Compute Service) servers — read-only list, mirroring AWS EC2.
aliyunAccountScoped.get('/ecs-instances', async (c) => {
  const result = await listEcsInstances(
    await aliyunHandleFor(c.get('aliyunBinding'), c.get('teamId')),
  )

  return c.json(result)
})

// Simple Application Server (轻量应用服务器) — read-only list, the Alibaba
// analogue of AWS Lightsail.
aliyunAccountScoped.get('/swas-instances', async (c) => {
  const result = await listSwasInstances(
    await aliyunHandleFor(c.get('aliyunBinding'), c.get('teamId')),
  )

  return c.json(result)
})

// `:clusterId` is the ACK cluster id.
aliyunAccountScoped.get('/clusters/:clusterId/kubeconfig', async (c) => {
  const clusterId = c.req.param('clusterId')
  const handle = await aliyunHandleFor(c.get('aliyunBinding'), c.get('teamId'))
  let region = c.req.query('region') || undefined

  if (!region) {
    const list = await listAckClusters(handle)
    const found = list.clusters.find((cl) => cl.aliyunClusterId === clusterId)

    if (!found) {
      throw new AppError(404, 'cluster_not_found', `Cluster ${clusterId} not found in this account`)
    }
    region = found.region
  }

  const result = await generateAckKubeconfig(handle, region, clusterId)

  if (!result) {
    throw new AppError(404, 'cluster_not_found', `Cluster ${clusterId} not found in ${region}`)
  }

  // Kubeconfig embeds credentials — never cache.
  c.header('Cache-Control', 'no-store')
  c.header('Content-Type', 'application/yaml; charset=utf-8')
  c.header('X-Kubeconfig-Expires-At', result.expiresAt.toISOString())

  return c.body(result.kubeconfig)
})
