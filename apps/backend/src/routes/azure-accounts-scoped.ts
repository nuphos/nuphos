import { Hono } from 'hono'

import {
  accessView,
  bindingAccessUpdateSchema,
  canUseAllowList,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { generateAksKubeconfig, listAksClusters, listAzureRoleAssignments } from '@/lib/byos/azure'
import { azureHandleFor } from '@/lib/byos/handles'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { AzureAccountBinding } from '@/models'
import type { MiddlewareHandler } from 'hono'

type AzureAccountVariables = TeamAuthVariables & {
  azureBinding: AzureAccountBinding
}

/**
 * Resolve the `:accountId` binding and pin it on ctx. Deliberately does NOT
 * exchange for a token: admin repair routes (DELETE, access) must keep working
 * even when the OIDC connector is unconfigured. Routes that actually call ARM
 * mint a handle lazily via `azureHandleFor`.
 */
function requireAzureAccount(): MiddlewareHandler<{ Variables: AzureAccountVariables }> {
  return async (c, next) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountIdParam = c.req.param('accountId')

    if (!accountIdParam) throw new AppError(400, 'invalid_request', 'Missing accountId param')
    const accountId = parseObjectId(accountIdParam, 'accountId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { azureAccounts: 1 } },
    )
    const binding = (doc?.azureAccounts ?? []).find((b) => b.id.equals(accountId))

    if (!binding) {
      throw new AppError(404, 'azure_account_not_found', 'Azure account binding not found')
    }
    c.set('azureBinding', binding)
    await next()
  }
}

export const azureAccountScoped = new Hono<{ Variables: AzureAccountVariables }>()

azureAccountScoped.use('*', requireAzureAccount())

azureAccountScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('azureBinding').access)),
)

azureAccountScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = c.get('azureBinding').id
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'azureAccounts.id': accountId },
      { $set: { 'azureAccounts.$.access': access, updatedAt: access.updatedAt } },
    )

    // Guard the concurrent-delete race: if the binding was removed between the
    // middleware fetch and this write, don't report success for a no-op.
    if (res.matchedCount === 0) {
      throw new AppError(404, 'azure_account_not_found', 'Azure account binding not found')
    }

    return c.json(accessView(access))
  },
)

azureAccountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = c.get('azureBinding').id

  await teamByosBindings().updateOne(
    { _id: teamId },
    { $pull: { azureAccounts: { id: accountId } }, $set: { updatedAt: new Date() } },
  )

  return c.body(null, 204)
})

// Below: any team member with allow-list access to this binding.
azureAccountScoped.use('*', async (c, next) => {
  if (
    c.get('teamRole') !== 'ADMINISTRATOR' &&
    !canUseAllowList(c.get('azureBinding').access?.memberAllowList, c.get('userId'))
  ) {
    throw new AppError(403, 'forbidden', 'You do not have access to this Azure binding')
  }
  await next()
})

azureAccountScoped.get('/', (c) => {
  const b = c.get('azureBinding')

  return c.json({
    accountId: b.id.toHexString(),
    label: b.label,
    tenantId: b.tenantId,
    clientId: b.clientId,
    subscriptionId: b.subscriptionId,
  })
})

// The team's own short-lived ARM access token for the sandbox/agent (az / ARM
// REST) — gated by the binding's member allow-list above. Minted fresh.
azureAccountScoped.get('/credentials', async (c) => {
  // Permission-admin bindings hold RBAC-write (escalation) power, so their token
  // must NEVER be exported — not even to administrators. Admins widen RBAC only
  // through the scoped role-assignment endpoints, which mint the token on the
  // backend; the token itself never leaves. Handing it out would put a
  // self-escalation credential into any caller's hands — including the agent
  // sandbox, which authenticates as the (admin) user.
  if (c.get('azureBinding').purpose === 'permission-admin') {
    throw new AppError(
      403,
      'permission_admin_no_token_export',
      'Credentials for a permission-admin Azure binding cannot be exported; remove this retired connection and connect an ordinary app instead',
    )
  }
  const handle = await azureHandleFor(c.get('azureBinding'), c.get('teamId'))

  // Reusable secret — never cache in clients or intermediaries.
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessToken: handle.accessToken,
    subscriptionId: handle.subscriptionId,
    expiresAt: handle.expiresAt.toISOString(),
  })
})

azureAccountScoped.get('/clusters', async (c) => {
  const result = await listAksClusters(await azureHandleFor(c.get('azureBinding'), c.get('teamId')))

  return c.json(result)
})

// The RBAC role assignments this app holds — the "what can this app do" detail
// (analog of an AWS role's attached policies). Read-only; safe for any member
// with allow-list access, including for permission-admin bindings.
azureAccountScoped.get('/role-assignments', async (c) => {
  const handle = await azureHandleFor(c.get('azureBinding'), c.get('teamId'))
  const assignments = await listAzureRoleAssignments(handle)

  return c.json({ assignments })
})

// `:clusterName` is the AKS managed cluster name; `resourceGroup` disambiguates
// same-named clusters across resource groups (falls back to a lookup by name).
azureAccountScoped.get('/clusters/:clusterName/kubeconfig', async (c) => {
  const clusterName = c.req.param('clusterName')
  const handle = await azureHandleFor(c.get('azureBinding'), c.get('teamId'))
  let resourceGroup = c.req.query('resourceGroup') || undefined

  if (!resourceGroup) {
    const list = await listAksClusters(handle)
    const found = list.clusters.find((cl) => cl.name === clusterName)

    if (!found?.azureResourceGroup) {
      throw new AppError(
        404,
        'cluster_not_found',
        `Cluster ${clusterName} not found in this subscription`,
      )
    }
    resourceGroup = found.azureResourceGroup
  }

  const result = await generateAksKubeconfig(handle, resourceGroup, clusterName)

  if (!result) {
    throw new AppError(
      404,
      'cluster_not_found',
      `Cluster ${clusterName} not found in ${resourceGroup}`,
    )
  }

  // Kubeconfig embeds credentials — never cache.
  c.header('Cache-Control', 'no-store')
  c.header('Content-Type', 'application/yaml; charset=utf-8')
  c.header('X-Kubeconfig-Expires-At', result.expiresAt.toISOString())

  return c.body(result.kubeconfig)
})
