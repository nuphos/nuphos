import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import {
  accessView,
  bindingAccessUpdateSchema,
  createBinderOnlyAccess,
  normalizeAccessInput,
} from '@/lib/byos/access'
import { encryptUpstashSecret } from '@/lib/byos/secrets'
import {
  credentialsFromBinding,
  listUpstashRedisDatabases,
  verifyUpstashCredentials,
  UpstashApiError,
} from '@/lib/byos/upstash'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  requireUpstashAccount,
  requireUpstashMemberAccess,
  requireTeamRole,
} from '@/middleware/auth'
import { emptyTeamByosBindings, teamByosBindings } from '@/models'

import type { UpstashAccountVariables, TeamAuthVariables } from '@/middleware/auth'
import type { UpstashAccountBinding } from '@/models'

export const upstashAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Upstash binds with an account email + a Management API key (Console → Account
// → Management API → Create API Key). No OAuth. The key is shown once by Upstash
// and grants full control of the account's Redis/Vector/QStash resources.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(200),
    apiKey: z.string().trim().min(1).max(400),
  })
  .strict()

export function publicView(binding: UpstashAccountBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    email: binding.email,
    createdAt: binding.createdAt,
  }
}

upstashAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { upstashAccounts: 1 } },
  )

  return c.json({ accounts: (doc?.upstashAccounts ?? []).map(publicView) })
})

upstashAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, email, apiKey } = c.req.valid('json')

    await verifyUpstashCredentials({ email, apiKey }).catch((err: unknown) => {
      if (err instanceof UpstashApiError && (err.status === 401 || err.status === 403)) {
        throw new AppError(
          400,
          'invalid_upstash_credentials',
          'The Upstash email or Management API key is invalid or has been revoked.',
        )
      }
      const message = err instanceof Error ? err.message : 'unknown error'

      throw new AppError(
        502,
        'upstash_api_unavailable',
        `Could not reach the Upstash API: ${message}`,
      )
    })

    const now = new Date()
    const binding: UpstashAccountBinding = {
      id: new ObjectId(),
      label,
      email,
      encryptedApiKey: encryptUpstashSecret(apiKey),
      createdAt: now,
      // Starts closed (binder only), unlike the `['*']` default elsewhere: an
      // Upstash Management key has no scopes and reaches every database's data,
      // so a new binding must not silently expose the whole account to the team.
      // Team admins are granted at the gate, not stored here.
      access: createBinderOnlyAccess(c.get('userId'), now),
    }

    // Dedup atomically rather than read-then-write: `email` is excluded in the
    // filter, so a concurrent bind of the same account can't slip between a
    // pre-check and the $push. When the account is already bound the filter
    // misses, upsert then tries to insert a second doc with this _id, and Mongo
    // rejects it with a duplicate-key error — which is the 409.
    await teamByosBindings()
      .updateOne(
        { _id: teamId, 'upstashAccounts.email': { $ne: email } },
        {
          $push: { upstashAccounts: binding },
          $set: { updatedAt: now },
          $setOnInsert: emptyTeamByosBindings(),
        },
        { upsert: true },
      )
      .catch((err: unknown) => {
        if ((err as { code?: number }).code === 11000) {
          throw new AppError(
            409,
            'upstash_account_already_bound',
            'This Upstash account is already bound',
          )
        }
        throw err
      })

    return c.json(publicView(binding), 201)
  },
)

const accountScoped = new Hono<{ Variables: UpstashAccountVariables }>()

accountScoped.use('*', requireUpstashAccount())

accountScoped.get('/', (c) => {
  return c.json({
    id: c.get('upstashAccountId'),
    label: c.get('upstashAccountLabel'),
    email: c.get('upstashBinding').email,
  })
})

accountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = new ObjectId(c.get('upstashAccountId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { upstashAccounts: { id: accountId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'upstash_account_not_bound', 'Upstash account not found')
  }

  return c.body(null, 204)
})

accountScoped.get('/access', requireTeamRole('ADMINISTRATOR'), (c) =>
  c.json(accessView(c.get('upstashAccess'))),
)

accountScoped.put(
  '/access',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindingAccessUpdateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = new ObjectId(c.get('upstashAccountId'))
    const access = normalizeAccessInput(c.req.valid('json'), c.get('userId'))
    const res = await teamByosBindings().updateOne(
      { _id: teamId, 'upstashAccounts.id': accountId },
      { $set: { 'upstashAccounts.$.access': access, updatedAt: new Date() } },
    )

    // Guard the concurrent-delete race: if the binding was removed between the
    // middleware fetch and this write, don't report success for a no-op.
    if (res.matchedCount === 0) {
      throw new AppError(404, 'upstash_account_not_bound', 'Upstash account not found')
    }

    return c.json(accessView(access))
  },
)

// Server-side proxy so desktop can list databases without ever holding the API
// key. The agent uses /credentials below and calls Upstash directly instead.
accountScoped.get('/databases', requireUpstashMemberAccess(), async (c) => {
  const databases = await listUpstashRedisDatabases(
    credentialsFromBinding(c.get('upstashBinding')),
  ).catch((err: unknown) => {
    if (err instanceof UpstashApiError && (err.status === 401 || err.status === 403)) {
      throw new AppError(
        400,
        'invalid_upstash_credentials',
        'The stored Upstash credentials are no longer valid. Re-bind the account.',
      )
    }
    throw new AppError(502, 'upstash_api_error', (err as Error).message)
  })

  return c.json({ databases })
})

// Agent credential handout, mirroring notion-integrations /credentials: the
// sandbox exchanges its NUPHOS_TOKEN for the binding's Upstash key and talks to
// api.upstash.com directly. Gated by the per-binding member allow-list. Upstash
// is a full read/write surface the agent drives itself, so it needs the raw key.
accountScoped.get('/credentials', requireUpstashMemberAccess(), (c) => {
  const binding = c.get('upstashBinding')
  const creds = credentialsFromBinding(binding)

  // A reusable credential over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: binding.id.toHexString(),
    label: binding.label,
    email: creds.email,
    apiKey: creds.apiKey,
    authType: 'upstash_basic',
  })
})

upstashAccountsRoutes.route('/:accountId', accountScoped)
