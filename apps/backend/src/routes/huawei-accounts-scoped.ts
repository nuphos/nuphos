import { Hono } from 'hono'

import { registerBindingAccessRoutes } from '@/lib/byos/access-routes'
import { huaweiHandleFor } from '@/lib/byos/handles'
import { BOOTSTRAP_REGION } from '@/lib/byos/huawei'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { canRequestUseBinding, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { HuaweiAccountBinding } from '@/models'
import type { MiddlewareHandler } from 'hono'

type HuaweiAccountVariables = TeamAuthVariables & {
  huaweiBinding: HuaweiAccountBinding
}

/**
 * Resolve the `:accountId` binding and pin it on ctx. Deliberately does NOT
 * federate: admin repair routes (DELETE, access) must keep working even when
 * the OIDC connector is unconfigured. Routes that need credentials federate
 * lazily via `huaweiHandleFor`.
 */
function requireHuaweiAccount(): MiddlewareHandler<{ Variables: HuaweiAccountVariables }> {
  return async (c, next) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountIdParam = c.req.param('accountId')

    if (!accountIdParam) throw new AppError(400, 'invalid_request', 'Missing accountId param')
    const accountId = parseObjectId(accountIdParam, 'accountId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { huaweiAccounts: 1 } },
    )
    const binding = (doc?.huaweiAccounts ?? []).find((b) => b.id.equals(accountId))

    if (!binding) {
      throw new AppError(404, 'huawei_account_not_found', 'Huawei Cloud account binding not found')
    }
    c.set('huaweiBinding', binding)
    await next()
  }
}

export const huaweiAccountScoped = new Hono<{ Variables: HuaweiAccountVariables }>()

huaweiAccountScoped.use('*', requireHuaweiAccount())

registerBindingAccessRoutes(huaweiAccountScoped, 'huaweiAccounts', (c) => c.get('huaweiBinding'))

huaweiAccountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = c.get('huaweiBinding').id

  await teamByosBindings().updateOne(
    { _id: teamId },
    { $pull: { huaweiAccounts: { id: accountId } }, $set: { updatedAt: new Date() } },
  )

  return c.body(null, 204)
})

// Below: any team member with allow-list access to this binding.
huaweiAccountScoped.use('*', async (c, next) => {
  if (!canRequestUseBinding(c, c.get('huaweiBinding').access)) {
    throw new AppError(403, 'forbidden', 'You do not have access to this Huawei Cloud binding')
  }
  await next()
})

huaweiAccountScoped.get('/', (c) => {
  const b = c.get('huaweiBinding')

  return c.json({
    accountId: b.id.toHexString(),
    label: b.label,
    domainId: b.domainId,
    idpId: b.idpId,
    agencyName: b.agencyName,
  })
})

// The team's own short-lived credentials for the sandbox/agent (hw-api.py,
// the SDKs, Terraform) — gated by the binding's member allow-list above.
// Federates fresh; the security token accompanies the temporary AK/SK.
huaweiAccountScoped.use('/credentials', requireTeamRole('ADMINISTRATOR', 'EDITOR'))
huaweiAccountScoped.get('/credentials', async (c) => {
  const handle = await huaweiHandleFor(c.get('huaweiBinding'), c.get('teamId'))

  // Reusable secret — never cache in clients or intermediaries.
  c.header('Cache-Control', 'no-store')

  return c.json({
    accessKeyId: handle.accessKeyId,
    secretAccessKey: handle.secretAccessKey,
    securityToken: handle.securityToken,
    expiresAt: handle.expiresAt.toISOString(),
    // Federated credentials carry no IAM user, so account-scoped calls need
    // the account id alongside them.
    domainId: c.get('huaweiBinding').domainId,
    defaultRegion: BOOTSTRAP_REGION,
  })
})
