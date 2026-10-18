import { createHash, randomBytes } from 'node:crypto'

import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  accessView,
  bindingAccessUpdateSchema,
  canUseAllowList,
  normalizeAccessInput,
} from '@/lib/byos/access'
import {
  buildPlaudAuthorizeUrl,
  invalidatePlaudAccessToken,
  plaudRedirectUri,
  registerPlaudClient,
  revokePlaudGrant,
} from '@/lib/byos/plaud'
import { encryptPlaudSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { plaudPendingOAuth, teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { PlaudAccountBinding } from '@/models'
import type { MiddlewareHandler } from 'hono'

export type PlaudAccountVariables = TeamAuthVariables & {
  plaudAccountId: string
  plaudBinding: PlaudAccountBinding
}

export const plaudAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

export function publicView(b: PlaudAccountBinding) {
  return {
    id: b.id.toHexString(),
    label: b.label,
    userName: b.userName,
    userEmail: b.userEmail,
    createdAt: b.createdAt,
  }
}

export function findPlaudAccount(bindings: PlaudAccountBinding[] | undefined, id: ObjectId) {
  return (bindings ?? []).find((b) => b.id.equals(id)) ?? null
}

export function requirePlaudAccount(): MiddlewareHandler<{ Variables: PlaudAccountVariables }> {
  return async (c, next) => {
    const param = c.req.param('bindingId')

    if (!param || !/^[a-f0-9]{24}$/i.test(param)) {
      throw new AppError(400, 'invalid_binding_id', 'bindingId must be a 24-character hex ObjectId')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { plaudAccounts: 1 } },
    )
    const binding = findPlaudAccount(doc?.plaudAccounts, new ObjectId(param))

    if (!binding) {
      throw new AppError(
        404,
        'plaud_account_not_bound',
        `Plaud account ${param} is not bound to this team`,
      )
    }
    c.set('plaudAccountId', param)
    c.set('plaudBinding', binding)
    await next()
  }
}

export function requirePlaudMemberAccess(): MiddlewareHandler<{
  Variables: PlaudAccountVariables
}> {
  return async (c, next) => {
    if (!canUseAllowList(c.get('plaudBinding').access?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'plaud_account_access_denied',
        'You are not allowed to use this Plaud account binding',
      )
    }
    await next()
  }
}

plaudAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { plaudAccounts: 1 } },
  )

  return c.json({ accounts: (doc?.plaudAccounts ?? []).map(publicView) })
})

plaudAccountsRoutes.post('/start-oauth', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const redirectUri = plaudRedirectUri()

  if (!redirectUri) {
    throw new AppError(
      503,
      'plaud_oauth_unavailable',
      'Plaud OAuth needs a public HTTPS backend URL (NUPHOS_PUBLIC_BACKEND_URL); locally, run the dev launcher with its Cloudflare tunnel.',
    )
  }
  const clientId = await registerPlaudClient(redirectUri)
  const state = randomBytes(24).toString('hex')
  const verifier = randomBytes(48).toString('base64url')
  const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

  await plaudPendingOAuth().insertOne({
    _id: state,
    teamId: parseObjectId(c.get('teamId'), 'teamId'),
    requesterUserId: c.get('userId'),
    clientId,
    redirectUri,
    encryptedCodeVerifier: encryptPlaudSecret(verifier),
    expiresAt,
  })

  return c.json({
    authorizeUrl: buildPlaudAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    }),
    state,
    expiresAt: expiresAt.toISOString(),
  })
})

plaudAccountsRoutes.delete('/start-oauth/:state', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const state = c.req.param('state')

  if (!/^[a-f0-9]{1,128}$/i.test(state)) {
    throw new AppError(400, 'invalid_state', 'Invalid state token')
  }
  await plaudPendingOAuth().deleteOne({
    _id: state,
    teamId: parseObjectId(c.get('teamId'), 'teamId'),
  })

  return c.body(null, 204)
})

const bindingScoped = new Hono<{ Variables: PlaudAccountVariables }>()

bindingScoped.use('*', requirePlaudAccount())

bindingScoped.get('/', (c) => c.json(publicView(c.get('plaudBinding'))))

bindingScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('plaudBinding')

  await teamByosBindings().updateOne(
    { _id: teamId },
    { $pull: { plaudAccounts: { id: binding.id } }, $set: { updatedAt: new Date() } },
  )
  // Revoke after the local delete so a Plaud outage never keeps the binding.
  await revokePlaudGrant(teamId, binding)
  invalidatePlaudAccessToken(teamId, binding.id)

  return c.body(null, 204)
})

bindingScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('plaudBinding').access)),
)

bindingScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))

    await teamByosBindings().updateOne(
      { _id: teamId, 'plaudAccounts.id': c.get('plaudBinding').id },
      { $set: { 'plaudAccounts.$.access': access, updatedAt: new Date() } },
    )

    return c.json(accessView(access))
  },
)

plaudAccountsRoutes.route('/:bindingId', bindingScoped)
