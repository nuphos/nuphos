import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { accessView, canUseAllowList, createDefaultAccess } from '@/lib/byos/access'
import { verifyAliyunRole, aliyunOidcInfo } from '@/lib/byos/aliyun'
import { aliyunConnectorSchema } from '@/lib/byos/connector-schemas'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { aliyunAccountScoped } from '@/routes/aliyun-accounts-scoped'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { AliyunAccountBinding } from '@/models'

export const aliyunAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// OIDC federation details the customer needs to register Nuphos as a RAM OIDC
// identity provider and pin their role's trust policy: issuer URL, audience
// (client id), and this team's subject claim. Team-scoped; safe to expose.
aliyunAccountsRoutes.get('/oidc-info', (c) => {
  return c.json(aliyunOidcInfo(c.get('teamId')))
})

// Shared by the list GET below and the aggregated /connectors endpoint.
export function aliyunAccountsView(
  bindings: AliyunAccountBinding[] | undefined,
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
    canUse: isAdmin || canUseAllowList(b.access?.memberAllowList, userId),
    createdAt: b.createdAt,
  }))
}

aliyunAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { aliyunAccounts: 1 } },
  )

  return c.json({
    accounts: aliyunAccountsView(doc?.aliyunAccounts, c.get('userId'), c.get('teamRole')),
  })
})

aliyunAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', aliyunConnectorSchema),
  async (c) => {
    const { label, site, roleArn, oidcProviderArn } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    // Refuse before the credential round trips below: a workspace at its
    // plan's environment limit shouldn't finish a bind it can't keep.

    // Fail fast on a missing/incorrect trust policy before storing a dead binding.
    await verifyAliyunRole(roleArn, oidcProviderArn, c.get('teamId'), site)

    const id = new ObjectId()
    const createdAt = new Date()
    const access = createDefaultAccess(c.get('userId'), createdAt)

    const inserted = await appendEnvironmentBinding(
      teamId,
      { 'aliyunAccounts.roleArn': { $ne: roleArn } },
      {
        $push: { aliyunAccounts: { id, label, site, roleArn, oidcProviderArn, createdAt, access } },
        $set: { updatedAt: createdAt },
      },
    )

    if (!inserted) {
      throw new AppError(
        409,
        'account_already_bound',
        `Alibaba Cloud role ${roleArn} is already bound`,
      )
    }

    return c.json({ accountId: id.toHexString(), label, site, roleArn, createdAt }, 201)
  },
)

aliyunAccountsRoutes.route('/:accountId', aliyunAccountScoped)
