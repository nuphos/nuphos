import { Hono } from 'hono'
import { MongoServerError, ObjectId } from 'mongodb'

import { accessView, canUseAllowList, createDefaultAccess } from '@/lib/byos/access'
import { huaweiConnectorSchema } from '@/lib/byos/connector-schemas'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { huaweiOidcInfo, verifyHuaweiIdentity } from '@/lib/byos/huawei'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { huaweiAccountScoped } from '@/routes/huawei-accounts-scoped'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { HuaweiAccountBinding } from '@/models'

export const huaweiAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// OIDC federation details the customer needs to register Nuphos as an IAM
// identity provider: issuer URL, audience (client id), and this team's
// subject claim to condition the assigned trust agency's trust policy on.
// Team-scoped; safe to expose (all values are meant to be shared with the
// customer).
huaweiAccountsRoutes.get('/oidc-info', (c) => {
  return c.json(huaweiOidcInfo(c.get('teamId')))
})

// Shared by the list GET below and the aggregated /connectors endpoint.
export function huaweiAccountsView(
  bindings: HuaweiAccountBinding[] | undefined,
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
    domainId: b.domainId,
    idpId: b.idpId,
    agencyName: b.agencyName,
    // The ACL (allow list + updatedAt/updatedBy) is admin-only metadata —
    // /access is admin-gated, so don't leak it to members in the list.
    ...(isAdmin ? { access: accessView(b.access) } : {}),
    canUse: isAdmin || canUseAllowList(b.access?.memberAllowList, userId),
    createdAt: b.createdAt,
  }))
}

huaweiAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { huaweiAccounts: 1 } },
  )

  return c.json({
    accounts: huaweiAccountsView(doc?.huaweiAccounts, c.get('userId'), c.get('teamRole')),
  })
})

huaweiAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', huaweiConnectorSchema),
  async (c) => {
    const { label, domainId, idpId, agencyName } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    // Refuse before the credential round trips below: a workspace at its plan's
    // environment limit shouldn't finish a bind it can't keep.

    // Huawei's trust-agency assumption authorizes by (identity provider,
    // audience, agency) alone — it does not require the token's `sub` to
    // match, unless the customer added that condition themselves. Refuse a
    // second, different team registering the exact same triple up front, so
    // the non-concurrent case doesn't burn a federation round trip; the
    // unique index (team_byos_huawei_account_unique) is the atomic guard
    // that actually closes the race, caught below.
    const claimedElsewhere = await teamByosBindings().findOne({
      _id: { $ne: teamId },
      huaweiAccounts: { $elemMatch: { domainId, idpId, agencyName } },
    })

    if (claimedElsewhere) {
      throw new AppError(
        409,
        'account_already_bound',
        `Huawei Cloud account ${domainId} is already bound by another team`,
      )
    }

    // Fail fast on a missing/misconfigured identity provider or trust agency
    // before storing a dead binding.
    await verifyHuaweiIdentity({ domainId, idpId, agencyName }, c.get('teamId'))

    const id = new ObjectId()
    const createdAt = new Date()
    const access = createDefaultAccess(c.get('userId'), createdAt)

    let inserted: boolean

    try {
      inserted = await appendEnvironmentBinding(
        teamId,
        { 'huaweiAccounts.domainId': { $ne: domainId } },
        {
          $push: {
            huaweiAccounts: { id, label, domainId, idpId, agencyName, createdAt, access },
          },
          $set: { updatedAt: createdAt },
        },
      )
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        throw new AppError(
          409,
          'account_already_bound',
          `Huawei Cloud account ${domainId} is already bound by another team`,
        )
      }
      throw e
    }

    if (!inserted) {
      throw new AppError(
        409,
        'account_already_bound',
        `Huawei Cloud account ${domainId} is already bound`,
      )
    }

    return c.json(
      { accountId: id.toHexString(), label, domainId, idpId, agencyName, createdAt },
      201,
    )
  },
)

huaweiAccountsRoutes.route('/:accountId', huaweiAccountScoped)
