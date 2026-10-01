import { Hono } from 'hono'

import {
  accessView,
  bindingAccessUpdateSchema,
  canUseAllowList,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { volcengineHandleFor } from '@/lib/byos/handles'
import { listVkeClusters, generateVkeKubeconfig, BOOTSTRAP_REGION } from '@/lib/byos/volcengine'
import { listVolcEcsInstances, getVolcRegions } from '@/lib/byos/volcengine-ecs'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { VolcengineAccountBinding } from '@/models'
import type { MiddlewareHandler } from 'hono'

type VolcengineAccountVariables = TeamAuthVariables & {
  volcengineBinding: VolcengineAccountBinding
}

/**
 * Resolve the `:accountId` binding and pin it on ctx. Deliberately does NOT
 * assume the role: admin repair routes (DELETE, access) must keep working even
 * when the OIDC connector is unconfigured. Routes that call VKE/ECS assume the
 * role lazily via `volcengineHandleFor`.
 */
function requireVolcengineAccount(): MiddlewareHandler<{ Variables: VolcengineAccountVariables }> {
  return async (c, next) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountIdParam = c.req.param('accountId')

    if (!accountIdParam) throw new AppError(400, 'invalid_request', 'Missing accountId param')
    const accountId = parseObjectId(accountIdParam, 'accountId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { volcengineAccounts: 1 } },
    )
    const binding = (doc?.volcengineAccounts ?? []).find((b) => b.id.equals(accountId))

    if (!binding) {
      throw new AppError(
        404,
        'volcengine_account_not_found',
        'Volcengine account binding not found',
      )
    }
    c.set('volcengineBinding', binding)
    await next()
  }
}

export const volcengineAccountScoped = new Hono<{ Variables: VolcengineAccountVariables }>()

volcengineAccountScoped.use('*', requireVolcengineAccount())

volcengineAccountScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('volcengineBinding').access)),
)

volcengineAccountScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = c.get('volcengineBinding').id
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'volcengineAccounts.id': accountId },
      { $set: { 'volcengineAccounts.$.access': access, updatedAt: access.updatedAt } },
    )

    // Guard the concurrent-delete race: if the binding was removed between the
    // middleware fetch and this write, don't report success for a no-op.
    if (res.matchedCount === 0) {
      throw new AppError(
        404,
        'volcengine_account_not_found',
        'Volcengine account binding not found',
      )
    }

    return c.json(accessView(access))
  },
)

volcengineAccountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = c.get('volcengineBinding').id

  await teamByosBindings().updateOne(
    { _id: teamId },
    { $pull: { volcengineAccounts: { id: accountId } }, $set: { updatedAt: new Date() } },
  )

  return c.body(null, 204)
})

// Below: any team member with allow-list access to this binding.
volcengineAccountScoped.use('*', async (c, next) => {
  if (
    c.get('teamRole') !== 'ADMINISTRATOR' &&
    !canUseAllowList(c.get('volcengineBinding').access?.memberAllowList, c.get('userId'))
  ) {
    throw new AppError(403, 'forbidden', 'You do not have access to this Volcengine binding')
  }
  await next()
})

volcengineAccountScoped.get('/', (c) => {
  const b = c.get('volcengineBinding')

  return c.json({ accountId: b.id.toHexString(), label: b.label, roleTrn: b.roleTrn })
})

// The team's own short-lived credentials for the sandbox/agent (ve CLI) —
// gated by the binding's member allow-list above. Assumes the role fresh; the
// SessionToken accompanies the temporary AK/SK. `defaultRegion` lets the CLI
// setup pick a region the credentials can authenticate against.
volcengineAccountScoped.get('/credentials', async (c) => {
  const handle = await volcengineHandleFor(c.get('volcengineBinding'), c.get('teamId'))

  // Reusable secret — never cache in clients or intermediaries.
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessKeyId: handle.accessKeyId,
    secretAccessKey: handle.secretAccessKey,
    sessionToken: handle.sessionToken,
    defaultRegion: BOOTSTRAP_REGION,
  })
})

// VKE's ListClusters is region-scoped — sweep the account's ECS region list.
volcengineAccountScoped.get('/clusters', async (c) => {
  const handle = await volcengineHandleFor(c.get('volcengineBinding'), c.get('teamId'))
  const regions = await getVolcRegions(handle)
  const result = await listVkeClusters(handle, regions)

  return c.json(result)
})

// ECS (Elastic Compute Service) servers — read-only list, mirroring AWS EC2.
volcengineAccountScoped.get('/ecs-instances', async (c) => {
  const result = await listVolcEcsInstances(
    await volcengineHandleFor(c.get('volcengineBinding'), c.get('teamId')),
  )

  return c.json(result)
})

// `:clusterId` is the VKE cluster id.
volcengineAccountScoped.get('/clusters/:clusterId/kubeconfig', async (c) => {
  const clusterId = c.req.param('clusterId')
  const handle = await volcengineHandleFor(c.get('volcengineBinding'), c.get('teamId'))
  let region = c.req.query('region') || undefined

  if (!region) {
    const regions = await getVolcRegions(handle)
    const list = await listVkeClusters(handle, regions)
    const found = list.clusters.find((cl) => cl.volcengineClusterId === clusterId)

    if (!found) {
      throw new AppError(404, 'cluster_not_found', `Cluster ${clusterId} not found in this account`)
    }
    region = found.region
  }

  // fresh=1 issues a NEW credential instead of reusing an existing one — used
  // by the desktop's RBAC re-check, because VKE grants only apply to
  // kubeconfigs issued after the grant.
  const fresh = c.req.query('fresh') === '1' || c.req.query('fresh') === 'true'
  const result = await generateVkeKubeconfig(handle, region, clusterId, { fresh })

  if (!result) {
    throw new AppError(404, 'cluster_not_found', `Cluster ${clusterId} not found in ${region}`)
  }

  // Kubeconfig embeds credentials — never cache.
  c.header('Cache-Control', 'no-store')
  c.header('Content-Type', 'application/yaml; charset=utf-8')
  c.header('X-Kubeconfig-Expires-At', result.expiresAt.toISOString())

  return c.body(result.kubeconfig)
})
