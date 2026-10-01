import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { accessView, canUseAllowList, createDefaultAccess } from '@/lib/byos/access'
import { tencentConnectorSchema } from '@/lib/byos/connector-schemas'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { verifyTencentRole, tencentOidcInfo } from '@/lib/byos/tencent'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { tencentAccountScoped } from '@/routes/tencent-accounts-scoped'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { TencentAccountBinding } from '@/models'

export const tencentAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// OIDC federation details the customer needs to register Nuphos as a CAM OIDC
// identity provider and pin their role's trust policy: issuer URL, audience
// (client id), and this team's subject claim. Team-scoped; safe to expose.
tencentAccountsRoutes.get('/oidc-info', (c) => {
  return c.json(tencentOidcInfo(c.get('teamId')))
})

// Shared by the list GET below and the aggregated /connectors endpoint.
export function tencentAccountsView(
  bindings: TencentAccountBinding[] | undefined,
  userId: string,
  teamRole: string,
) {
  const isAdmin = teamRole === 'ADMINISTRATOR'
  const all = bindings ?? []
  const visibleBindings = isAdmin
    ? all
    : all.filter((b) => canUseAllowList(b.access?.memberAllowList, userId))

  return visibleBindings.map((b) => ({
    accountId: b.id.toHexString(),
    label: b.label,
    site: b.site ?? 'china',
    roleArn: b.roleArn,
    // The ACL (allow list + updatedAt/updatedBy) is admin-only metadata —
    // /access is admin-gated, so don't leak it to members in the list.
    ...(isAdmin ? { access: accessView(b.access) } : {}),
    // Admins pass the member-access gate regardless of the allow-list, so
    // report canUse accordingly (matches the scoped route's gate).
    canUse: isAdmin || canUseAllowList(b.access?.memberAllowList, userId),
    createdAt: b.createdAt,
  }))
}

tencentAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { tencentAccounts: 1 } },
  )

  return c.json({
    accounts: tencentAccountsView(doc?.tencentAccounts, c.get('userId'), c.get('teamRole')),
  })
})

tencentAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', tencentConnectorSchema),
  async (c) => {
    const { label, site, roleArn, providerId } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    // Refuse before the credential round trips below: a workspace at its
    // plan's environment limit shouldn't finish a bind it can't keep.

    // Fail fast on a missing/incorrect trust policy before storing a dead binding.
    await verifyTencentRole(roleArn, providerId, c.get('teamId'), site)

    const id = new ObjectId()
    const createdAt = new Date()
    const access = createDefaultAccess(c.get('userId'), createdAt)

    const inserted = await appendEnvironmentBinding(
      teamId,
      { 'tencentAccounts.roleArn': { $ne: roleArn } },
      {
        $push: { tencentAccounts: { id, label, site, roleArn, providerId, createdAt, access } },
        $set: { updatedAt: createdAt },
      },
    )

    if (!inserted) {
      throw new AppError(409, 'account_already_bound', `Tencent role ${roleArn} is already bound`)
    }

    return c.json({ accountId: id.toHexString(), label, site, roleArn, createdAt }, 201)
  },
)

tencentAccountsRoutes.route('/:accountId', tencentAccountScoped)
