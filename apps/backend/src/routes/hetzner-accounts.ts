import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { listHetznerServers, verifyHetznerToken, HetznerApiError } from '@/lib/byos/hetzner'
import { encryptHetznerToken, decryptHetznerToken } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  requireHetznerAccount,
  requireHetznerMemberAccess,
  requireTeamRole,
} from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { HetznerAccountVariables, TeamAuthVariables } from '@/middleware/auth'
import type { HetznerAccountBinding } from '@/models'

export const hetznerAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    token: z.string().trim().min(1),
  })
  .strict()

export function publicView(binding: HetznerAccountBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    createdAt: binding.createdAt,
  }
}

hetznerAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { hetznerAccounts: 1 } },
  )

  return c.json({ accounts: (doc?.hetznerAccounts ?? []).map(publicView) })
})

hetznerAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, token } = c.req.valid('json')

    // Refuse before the credential round trips below: a workspace at its
    // plan's environment limit shouldn't finish a bind it can't keep.

    await verifyHetznerToken({ token }).catch((err: unknown) => {
      if (err instanceof HetznerApiError && err.status === 401) {
        throw new AppError(
          400,
          'invalid_hetzner_token',
          'The Hetzner Cloud API token is invalid or has been revoked.',
        )
      }
      throw new AppError(
        502,
        'hetzner_api_unavailable',
        `Could not reach Hetzner API: ${(err as Error).message}`,
      )
    })

    const encryptedToken = encryptHetznerToken(token)
    const now = new Date()
    const binding: HetznerAccountBinding = {
      id: new ObjectId(),
      label,
      encryptedToken,
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await appendEnvironmentBinding(
      teamId,
      {},
      {
        $push: { hetznerAccounts: binding },
        $set: { updatedAt: now },
      },
    )

    return c.json(publicView(binding), 201)
  },
)

const accountScoped = new Hono<{ Variables: HetznerAccountVariables }>()

accountScoped.use('*', requireHetznerAccount())

accountScoped.get('/', (c) => {
  return c.json({
    id: c.get('hetznerAccountId'),
    label: c.get('hetznerAccountLabel'),
  })
})

accountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = new ObjectId(c.get('hetznerAccountId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { hetznerAccounts: { id: accountId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'hetzner_account_not_bound', 'Hetzner account not found')
  }

  return c.body(null, 204)
})

accountScoped.get('/credentials', requireHetznerMemberAccess(), async (c) => {
  const token = decryptHetznerToken(c.get('hetznerEncryptedToken'))

  return c.json({ token })
})

accountScoped.get('/servers', requireHetznerMemberAccess(), async (c) => {
  const token = decryptHetznerToken(c.get('hetznerEncryptedToken'))
  const servers = await listHetznerServers({ token }).catch((err: unknown) => {
    throw new AppError(502, 'hetzner_api_error', (err as Error).message)
  })

  return c.json({ servers })
})

hetznerAccountsRoutes.route('/:accountId', accountScoped)
