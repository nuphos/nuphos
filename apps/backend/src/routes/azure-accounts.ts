import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { accessView, canUseAllowList, createDefaultAccess } from '@/lib/byos/access'
import { azureOidcInfo, verifyAzureBinding } from '@/lib/byos/azure'
import { azureConnectorSchema } from '@/lib/byos/connector-schemas'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import { azureAccountScoped } from '@/routes/azure-accounts-scoped'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { AzureAccountBinding } from '@/models'

export const azureAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// OIDC federation details the customer needs to add a federated credential to
// their Entra app registration: issuer URL, this team's subject claim, and the
// audience. Team-scoped; safe to expose.
azureAccountsRoutes.get('/oidc-info', (c) => {
  return c.json(azureOidcInfo(c.get('teamId')))
})

// Shared by the list GET below and the aggregated /connectors endpoint.
export function azureAccountsView(
  bindings: AzureAccountBinding[] | undefined,
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
    tenantId: b.tenantId,
    clientId: b.clientId,
    subscriptionId: b.subscriptionId,
    // Surfaced so the UI can badge break-glass bindings and never offer them for
    // agent use.
    purpose: b.purpose ?? null,
    // The ACL is admin-only metadata — /access is admin-gated, so don't leak it
    // to members in the list.
    ...(isAdmin ? { access: accessView(b.access) } : {}),
    // Admins pass the member-access gate regardless of the allow-list.
    canUse: isAdmin || canUseAllowList(b.access?.memberAllowList, userId),
    createdAt: b.createdAt,
  }))
}

azureAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { azureAccounts: 1 } },
  )

  return c.json({
    accounts: azureAccountsView(doc?.azureAccounts, c.get('userId'), c.get('teamRole')),
  })
})

azureAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', azureConnectorSchema),
  async (c) => {
    const { label, tenantId, clientId, subscriptionId } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    // Refuse before the credential round trips below: a workspace at its
    // plan's environment limit shouldn't finish a bind it can't keep.

    // Fail fast on a bad federation / missing role assignment before storing a
    // dead binding.
    await verifyAzureBinding({ tenantId, clientId, subscriptionId }, c.get('teamId'))

    const id = new ObjectId()
    const createdAt = new Date()
    const access = createDefaultAccess(c.get('userId'), createdAt)

    const inserted = await appendEnvironmentBinding(
      teamId,
      { azureAccounts: { $not: { $elemMatch: { clientId, subscriptionId } } } },
      {
        $push: {
          azureAccounts: {
            id,
            label,
            tenantId,
            clientId,
            subscriptionId,
            createdAt,
            access,
          },
        },
        $set: { updatedAt: createdAt },
      },
    )

    if (!inserted) {
      throw new AppError(
        409,
        'account_already_bound',
        `Azure app ${clientId} is already bound to subscription ${subscriptionId}`,
      )
    }

    return c.json(
      {
        accountId: id.toHexString(),
        label,
        tenantId,
        clientId,
        subscriptionId,
        createdAt,
      },
      201,
    )
  },
)

azureAccountsRoutes.route('/:accountId', azureAccountScoped)
