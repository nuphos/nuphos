import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { listZeaburProviderBindings, syncZeaburProviderBindings } from '@/lib/byos/account'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { decryptZeaburToken, encryptZeaburToken } from '@/lib/byos/secrets'
import { discoverZeaburIdentities, listZeaburProjects, listZeaburServers } from '@/lib/byos/zeabur'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { ZeaburProviderBinding } from '@/models'
import type { Context } from 'hono'

export const zeaburProvidersRoutes = new Hono<{ Variables: TeamAuthVariables }>()
const ZEABUR_IDENTITY_SYNC_INTERVAL_MS = 5 * 60 * 1000

const bindSchema = z
  .object({
    token: z.string().trim().min(1),
  })
  .strict()

export function publicView(binding: ZeaburProviderBinding) {
  return (binding.identities ?? []).map((identity) => ({
    providerId: binding.id.toHexString(),
    zeaburId: identity.zeaburId,
    kind: identity.kind,
    name: identity.name,
    createdAt: binding.createdAt,
  }))
}

zeaburProvidersRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const bindings = await syncZeaburProviderBindings(teamId, {
    minIntervalMs: ZEABUR_IDENTITY_SYNC_INTERVAL_MS,
    fallbackOnError: true,
  })

  return c.json({ providers: bindings.flatMap(publicView) })
})

zeaburProvidersRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const atlasTeamId = parseObjectId(c.get('teamId'), 'teamId')
    const { token } = c.req.valid('json')

    // Refuse before the credential round trips below: a workspace at its
    // plan's environment limit shouldn't finish a bind it can't keep.
    const identities = await discoverZeaburIdentities(token)

    const now = new Date()
    const binding: ZeaburProviderBinding = {
      id: new ObjectId(),
      encryptedToken: encryptZeaburToken(token),
      identities,
      createdAt: now,
      lastSyncedAt: now,
    }

    await appendEnvironmentBinding(
      atlasTeamId,
      {},
      {
        $push: { zeaburProviders: binding },
        $set: { updatedAt: now },
      },
    )

    return c.json({ providers: publicView(binding) }, 201)
  },
)

function getZeaburIdParam(c: Context<{ Variables: TeamAuthVariables }>) {
  const zeaburId = c.req.param('zeaburId')?.trim()

  if (!zeaburId) {
    throw new AppError(400, 'invalid_zeabur_id', 'zeaburId is required')
  }

  return zeaburId
}

async function getZeaburHandle(teamId: ObjectId, zeaburId: string) {
  const binding = (await listZeaburProviderBindings(teamId)).find((item) =>
    item.identities?.some((identity) => identity.zeaburId === zeaburId),
  )
  const identity = binding?.identities?.find((item) => item.zeaburId === zeaburId)

  if (!binding || !identity) {
    throw new AppError(404, 'zeabur_identity_not_bound', 'Zeabur identity not found')
  }

  return {
    token: decryptZeaburToken(binding.encryptedToken),
    zeaburId,
    kind: identity.kind,
  }
}

zeaburProvidersRoutes.get('/:zeaburId/credentials', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const handle = await getZeaburHandle(teamId, getZeaburIdParam(c))

  return c.json({
    zeaburId: handle.zeaburId,
    token: handle.token,
  })
})

zeaburProvidersRoutes.get('/:zeaburId/projects', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const projects = await listZeaburProjects(await getZeaburHandle(teamId, getZeaburIdParam(c)))

  return c.json({ projects })
})

zeaburProvidersRoutes.get('/:zeaburId/servers', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const servers = await listZeaburServers(await getZeaburHandle(teamId, getZeaburIdParam(c)))

  return c.json({ servers })
})

zeaburProvidersRoutes.delete('/:zeaburId', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const zeaburId = getZeaburIdParam(c)
  const result = await teamByosBindings().updateOne(
    {
      _id: parseObjectId(c.get('teamId'), 'teamId'),
      'zeaburProviders.identities.zeaburId': zeaburId,
    },
    {
      $pull: { 'zeaburProviders.$.identities': { zeaburId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'zeabur_identity_not_bound', 'Zeabur identity not found')
  }
  await teamByosBindings().updateOne(
    { _id: parseObjectId(c.get('teamId'), 'teamId') },
    { $pull: { zeaburProviders: { identities: { $size: 0 } } } },
  )

  return c.body(null, 204)
})
