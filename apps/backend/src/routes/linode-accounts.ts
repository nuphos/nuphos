import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import {
  listLinodeInstances,
  listLkeClusters,
  getLkeKubeconfig,
  verifyLinodeToken,
  LinodeApiError,
} from '@/lib/byos/linode'
import { encryptLinodeToken, decryptLinodeToken } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireLinodeAccount, requireLinodeMemberAccess, requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { LinodeAccountVariables, TeamAuthVariables } from '@/middleware/auth'
import type { LinodeAccountBinding } from '@/models'

export const linodeAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    token: z.string().trim().min(1),
  })
  .strict()

export function publicView(binding: LinodeAccountBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    createdAt: binding.createdAt,
  }
}

linodeAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { linodeAccounts: 1 } },
  )

  return c.json({ accounts: (doc?.linodeAccounts ?? []).map(publicView) })
})

linodeAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, token } = c.req.valid('json')

    // Refuse before the credential round trips below: a workspace at its
    // plan's environment limit shouldn't finish a bind it can't keep.

    await verifyLinodeToken({ token }).catch((err: unknown) => {
      if (err instanceof LinodeApiError && err.status === 401) {
        throw new AppError(
          400,
          'invalid_linode_token',
          'The Linode Personal Access Token is invalid or has been revoked.',
        )
      }
      throw new AppError(
        502,
        'linode_api_unavailable',
        `Could not reach Linode API: ${(err as Error).message}`,
      )
    })

    const encryptedToken = encryptLinodeToken(token)
    const now = new Date()
    const binding: LinodeAccountBinding = {
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
        $push: { linodeAccounts: binding },
        $set: { updatedAt: now },
      },
    )

    return c.json(publicView(binding), 201)
  },
)

const accountScoped = new Hono<{ Variables: LinodeAccountVariables }>()

accountScoped.use('*', requireLinodeAccount())

accountScoped.get('/', (c) => {
  return c.json({
    id: c.get('linodeAccountId'),
    label: c.get('linodeAccountLabel'),
  })
})

accountScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const accountId = new ObjectId(c.get('linodeAccountId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { linodeAccounts: { id: accountId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'linode_account_not_bound', 'Linode account not found')
  }

  return c.body(null, 204)
})

accountScoped.get('/credentials', requireLinodeMemberAccess(), async (c) => {
  const token = decryptLinodeToken(c.get('linodeEncryptedToken'))

  return c.json({ token })
})

accountScoped.get('/instances', requireLinodeMemberAccess(), async (c) => {
  const token = decryptLinodeToken(c.get('linodeEncryptedToken'))
  const instances = await listLinodeInstances({ token }).catch((err: unknown) => {
    throw new AppError(502, 'linode_api_error', (err as Error).message)
  })

  return c.json({ instances })
})

accountScoped.get('/lke-clusters', requireLinodeMemberAccess(), async (c) => {
  const token = decryptLinodeToken(c.get('linodeEncryptedToken'))
  const clusters = await listLkeClusters({ token }).catch((err: unknown) => {
    throw new AppError(502, 'linode_api_error', (err as Error).message)
  })

  return c.json({ clusters })
})

accountScoped.get('/lke-clusters/:clusterId/kubeconfig', requireLinodeMemberAccess(), async (c) => {
  const clusterIdParam = c.req.param('clusterId')
  const clusterId = Number(clusterIdParam)

  if (!Number.isInteger(clusterId) || clusterId <= 0) {
    throw new AppError(400, 'invalid_cluster_id', 'clusterId must be a positive integer')
  }
  const token = decryptLinodeToken(c.get('linodeEncryptedToken'))
  const yaml = await getLkeKubeconfig({ token }, clusterId).catch((err: unknown) => {
    throw new AppError(502, 'linode_api_error', (err as Error).message)
  })

  return new Response(yaml, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
})

linodeAccountsRoutes.route('/:accountId', accountScoped)
