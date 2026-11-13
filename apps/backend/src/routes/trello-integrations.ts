import { randomBytes } from 'node:crypto'

import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  accessView,
  bindingAccessUpdateSchema,
  normalizeAccessInput,
  createBinderOnlyAccess,
} from '@/lib/byos/access'
import { trelloConnectLink } from '@/lib/byos/trello'
import { publicBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { logError } from '@/lib/observability'
import { composioUserId, deleteComposioAccount } from '@/lib/personal-credentials/composio'
import { zv } from '@/lib/validate'
import { requireTrelloIntegration, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings, trelloPendingOAuth } from '@/models'

import type { TrelloIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { TrelloIntegrationBinding } from '@/models'

export const trelloIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

export function publicView(binding: TrelloIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    memberId: binding.memberId,
    username: binding.username,
    authorizedBy: binding.authorizedBy,
    createdAt: binding.createdAt,
  }
}

trelloIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { trelloIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.trelloIntegrations ?? []).map(publicView) })
})

trelloIntegrationsRoutes.post('/start-oauth', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const requesterUserId = c.get('userId')
  const state = randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 10 * 60_000)
  const base = publicBackendUrl()

  if (!base?.startsWith('https://'))
    throw new AppError(503, 'trello_not_configured', 'A public HTTPS backend URL is required')
  const callback = new URL('/trello-app/setup', base)

  callback.searchParams.set('state', state)
  const link = await trelloConnectLink(
    composioUserId(teamId.toHexString(), requesterUserId),
    callback.href,
  )

  await trelloPendingOAuth().insertOne({
    _id: state,
    teamId,
    requesterUserId,
    composioAccountId: link.accountId,
    expiresAt,
  })

  return c.json({ state, authorizeUrl: link.authorizeUrl, expiresAt: expiresAt.toISOString() })
})

trelloIntegrationsRoutes.delete(
  '/start-oauth/:state',
  requireTeamRole('ADMINISTRATOR'),
  async (c) => {
    const pending = await trelloPendingOAuth().findOneAndDelete({
      _id: c.req.param('state'),
      teamId: parseObjectId(c.get('teamId'), 'teamId'),
      requesterUserId: c.get('userId'),
    })

    if (pending) await deleteComposioAccount(pending.composioAccountId)

    return c.body(null, 204)
  },
)

const integrationScoped = new Hono<{ Variables: TrelloIntegrationVariables }>()

integrationScoped.use('*', requireTrelloIntegration())
integrationScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('trelloAccess'))),
)
integrationScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const result = await teamByosBindings().updateOne(
      {
        _id: parseObjectId(c.get('teamId'), 'teamId'),
        'trelloIntegrations.id': c.get('trelloBinding').id,
      },
      { $set: { 'trelloIntegrations.$.access': access, updatedAt: new Date() } },
    )

    if (!result.matchedCount)
      throw new AppError(404, 'trello_not_bound', 'Trello connection not found')

    return c.json(accessView(access))
  },
)
integrationScoped.get('/', (c) => c.json(publicView(c.get('trelloBinding'))))
integrationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const binding = c.get('trelloBinding')

  // Remove the remote connection first; on failure the local binding remains retryable.
  await deleteComposioAccount(binding.composioAccountId)
  await teamByosBindings().updateOne(
    { _id: parseObjectId(c.get('teamId'), 'teamId') },
    { $pull: { trelloIntegrations: { id: binding.id } }, $set: { updatedAt: new Date() } },
  )

  return c.body(null, 204)
})
trelloIntegrationsRoutes.route('/:integrationId', integrationScoped)

type Draft = Pick<
  TrelloIntegrationBinding,
  'memberId' | 'username' | 'composioAccountId' | 'composioUserId' | 'authorizedBy'
>

export async function persistTrelloBinding(
  teamId: ObjectId,
  draft: Draft,
): Promise<Record<string, string>> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { trelloIntegrations: 1 } },
  )
  const existing = doc?.trelloIntegrations?.find(
    (binding) => binding.memberId === draft.memberId && binding.authorizedBy === draft.authorizedBy,
  )
  const binding: TrelloIntegrationBinding = {
    ...draft,
    id: existing?.id ?? new ObjectId(),
    label: existing?.label ?? draft.username,
    createdAt: existing?.createdAt ?? new Date(),
    access: existing?.access ?? createBinderOnlyAccess(draft.authorizedBy),
  }

  if (existing) {
    const result = await teamByosBindings().updateOne(
      { _id: teamId, 'trelloIntegrations.id': existing.id },
      { $set: { 'trelloIntegrations.$': binding, updatedAt: new Date() } },
    )

    if (!result.matchedCount)
      throw new AppError(
        409,
        'trello_reconnect_conflict',
        'Trello connection changed during authorization. Try again.',
      )
    if (existing.composioAccountId !== binding.composioAccountId) {
      await deleteComposioAccount(existing.composioAccountId).catch((error: unknown) =>
        logError('trello.previous_connection_cleanup_failed', error),
      )
    }
  } else
    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { trelloIntegrations: binding },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

  return {
    binding_id: binding.id.toHexString(),
    team_id: teamId.toHexString(),
    account_name: binding.label,
  }
}
