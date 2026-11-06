import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { config } from '@/config'
import { accountSizes, findInstaboxAccount } from '@/lib/agent/devices/box-instabox-account'
import { listTeamBoxes } from '@/lib/agent/devices/store'
import { decryptInstaboxSecret, encryptInstaboxSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { InstaboxAccountBinding } from '@/models'

// A team's own instabox account: Boxes created on it are billed by instabox to
// the team. The API key never leaves the backend; only admins bind or unbind.
export const instaboxAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    apiKey: z.string().trim().min(1).max(300),
  })
  .strict()
const accountParam = z.object({ accountId: z.string().trim().min(1).max(64) })

export function publicView(binding: InstaboxAccountBinding) {
  return { id: binding.id.toHexString(), label: binding.label, createdAt: binding.createdAt }
}

/** The key's sizes; a bad key is the caller's 400, anything else instabox's 502. */
function readSizes(apiKey: string) {
  const apiUrl = config.box.instabox?.apiUrl

  return accountSizes({ apiKey, ...(apiUrl ? { apiUrl } : {}) }).catch((error: unknown) => {
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)

    throw new AppError(502, 'instabox_unavailable', `Could not reach instabox: ${message}`)
  })
}

instaboxAccountsRoutes.get('/', async (c) => {
  const doc = await teamByosBindings().findOne(
    { _id: parseObjectId(c.get('teamId'), 'teamId') },
    { projection: { instaboxAccounts: 1 } },
  )

  return c.json({ accounts: (doc?.instaboxAccounts ?? []).map(publicView) })
})

instaboxAccountsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const { label, apiKey } = c.req.valid('json')

    await readSizes(apiKey)
    const now = new Date()
    const binding: InstaboxAccountBinding = {
      id: new ObjectId(),
      label,
      encryptedApiKey: encryptInstaboxSecret(apiKey),
      createdAt: now,
    }

    await teamByosBindings().updateOne(
      { _id: parseObjectId(c.get('teamId'), 'teamId') },
      {
        $push: { instaboxAccounts: binding },
        $set: { updatedAt: now },
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

    return c.json(publicView(binding), 201)
  },
)

async function requireAccount(teamId: string, accountId: string) {
  const account = await findInstaboxAccount(teamId, accountId)

  if (!account)
    throw new AppError(404, 'instabox_account_not_bound', 'No such instabox account in this team')

  return account
}

// The sizes a new Box on this account can have, smallest first.
instaboxAccountsRoutes.get('/:accountId', zv('param', accountParam), async (c) => {
  const account = await requireAccount(c.get('teamId'), c.req.valid('param').accountId)

  return c.json({
    ...publicView(account),
    sizes: await readSizes(decryptInstaboxSecret(account.encryptedApiKey)),
  })
})

// Machines on the account are never deleted implicitly: unbinding waits until its
// Boxes are gone, since without the key nothing could manage or delete them.
instaboxAccountsRoutes.delete(
  '/:accountId',
  requireTeamRole('ADMINISTRATOR'),
  zv('param', accountParam),
  async (c) => {
    const teamId = c.get('teamId')
    const { accountId } = c.req.valid('param')

    await requireAccount(teamId, accountId)
    const boxes = (await listTeamBoxes(teamId)).filter((d) => d.box?.accountId === accountId)

    if (boxes.length > 0)
      throw new AppError(
        409,
        'instabox_account_in_use',
        `Delete its Boxes first: ${boxes.map((d) => d.label).join(', ')}`,
      )
    await teamByosBindings().updateOne(
      { _id: parseObjectId(teamId, 'teamId') },
      {
        $pull: { instaboxAccounts: { id: new ObjectId(accountId) } },
        $set: { updatedAt: new Date() },
      },
    )

    return c.body(null, 204)
  },
)
