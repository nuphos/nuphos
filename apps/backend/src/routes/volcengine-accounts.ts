import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { accessView, canUseAllowList, createDefaultAccess } from '@/lib/byos/access'
import { volcengineConnectorSchema } from '@/lib/byos/connector-schemas'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { verifyVolcengineRole, volcengineOidcInfo } from '@/lib/byos/volcengine'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { volcengineAccountScoped } from '@/routes/volcengine-accounts-scoped'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { VolcengineAccountBinding } from '@/models'

export const volcengineAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// OIDC federation details the customer needs to register Nuphos as an IAM OIDC
// identity provider and pin their role's trust policy: issuer URL, audience
// (client id), and this team's subject claim. Team-scoped; safe to expose (all
// values are meant to be shared with the customer).
volcengineAccountsRoutes.get('/oidc-info', (c) => {
  return c.json(volcengineOidcInfo(c.get('teamId')))
})

// Shared by the list GET below and the aggregated /connectors endpoint.
export function volcengineAccountsView(
  bindings: VolcengineAccountBinding[] | undefined,
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
    roleTrn: b.roleTrn,
    // The ACL (allow list + updatedAt/updatedBy) is admin-only metadata —
    // /access is admin-gated, so don't leak it to members in the list.
    ...(isAdmin ? { access: accessView(b.access) } : {}),
    canUse: isAdmin || canUseAllowList(b.access?.memberAllowList, userId),
    createdAt: b.createdAt,
  }))
}

volcengineAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { volcengineAccounts: 1 } },
  )

  return c.json({
    accounts: volcengineAccountsView(doc?.volcengineAccounts, c.get('userId'), c.get('teamRole')),
  })
})

volcengineAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', volcengineConnectorSchema),
  async (c) => {
    const { label, roleTrn } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    // Refuse before the credential round trips below: a workspace at its
    // plan's environment limit shouldn't finish a bind it can't keep.

    // Fail fast on a missing/incorrect trust policy before storing a dead binding.
    await verifyVolcengineRole(roleTrn, c.get('teamId'))

    const id = new ObjectId()
    const createdAt = new Date()
    const access = createDefaultAccess(c.get('userId'), createdAt)

    const inserted = await appendEnvironmentBinding(
      teamId,
      { 'volcengineAccounts.roleTrn': { $ne: roleTrn } },
      {
        $push: { volcengineAccounts: { id, label, roleTrn, createdAt, access } },
        $set: { updatedAt: createdAt },
      },
    )

    if (!inserted) {
      throw new AppError(
        409,
        'account_already_bound',
        `Volcengine role ${roleTrn} is already bound`,
      )
    }

    return c.json({ accountId: id.toHexString(), label, roleTrn, createdAt }, 201)
  },
)

volcengineAccountsRoutes.route('/:accountId', volcengineAccountScoped)
