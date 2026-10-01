import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { decryptUptimeKumaSecret } from '@/lib/byos/secrets'
import { verifyUptimeKumaCredentials } from '@/lib/byos/uptime-kuma'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole, requireUptimeKumaMemberAccess } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import {
  baseUrlSchema,
  encryptUptimeKumaSecretOrUnavailable,
  publicView,
  uptimeKumaError,
} from '@/routes/uptime-kuma-instances/shared'

import type { UptimeKumaAuthHandle } from '@/lib/byos/uptime-kuma'
import type { UptimeKumaInstanceVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const updateSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    baseUrl: baseUrlSchema.optional(),
    username: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(1).optional(),
    authToken: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Uptime Kuma instance setting to update',
  })

export function registerUptimeKumaInstanceRoutes(
  instanceScoped: Hono<{ Variables: UptimeKumaInstanceVariables }>,
) {
  instanceScoped.get('/', requireUptimeKumaMemberAccess(), (c) => {
    return c.json(publicView(c.get('uptimeKumaBinding')))
  })

  instanceScoped.patch(
    '/',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', updateSchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const instanceId = new ObjectId(c.get('uptimeKumaInstanceId'))
      const current = c.get('uptimeKumaBinding')
      const patch = c.req.valid('json')

      const nextBaseUrl = patch.baseUrl ?? current.baseUrl
      const patchUsesPasswordAuth = patch.username !== undefined || patch.password !== undefined
      const credentialsChanged =
        patch.baseUrl !== undefined ||
        patch.username !== undefined ||
        patch.password !== undefined ||
        patch.authToken !== undefined

      if (credentialsChanged) {
        const storedAuthToken = current.encryptedAuthToken
          ? decryptUptimeKumaSecret(current.encryptedAuthToken)
          : undefined
        let nextHandle: UptimeKumaAuthHandle

        if (patch.authToken !== undefined) {
          nextHandle = { baseUrl: nextBaseUrl, authToken: patch.authToken }
        } else if (storedAuthToken && !patchUsesPasswordAuth) {
          nextHandle = { baseUrl: nextBaseUrl, authToken: storedAuthToken }
        } else {
          const nextUsername = patch.username ?? current.username
          const nextPassword =
            patch.password ??
            (current.encryptedPassword
              ? decryptUptimeKumaSecret(current.encryptedPassword)
              : undefined)

          if (!nextUsername || !nextPassword) {
            throw new AppError(
              400,
              'invalid_uptime_kuma_credentials',
              'Provide both username and password, or provide an auth token',
            )
          }
          nextHandle = { baseUrl: nextBaseUrl, username: nextUsername, password: nextPassword }
        }

        await verifyUptimeKumaCredentials(nextHandle).catch((err: unknown) => {
          throw uptimeKumaError(err, 'Uptime Kuma credentials could not be verified')
        })
      }

      const now = new Date()
      const set: Record<string, unknown> = { updatedAt: now }
      const unset: Record<string, ''> = {}

      if (patch.label !== undefined) set['uptimeKumaInstances.$.label'] = patch.label
      if (patch.baseUrl !== undefined) set['uptimeKumaInstances.$.baseUrl'] = patch.baseUrl
      if (patch.authToken !== undefined) {
        set['uptimeKumaInstances.$.encryptedAuthToken'] = encryptUptimeKumaSecretOrUnavailable(
          patch.authToken,
        )
        unset['uptimeKumaInstances.$.username'] = ''
        unset['uptimeKumaInstances.$.encryptedPassword'] = ''
      } else {
        if (patch.username !== undefined) set['uptimeKumaInstances.$.username'] = patch.username
        if (patch.password !== undefined) {
          set['uptimeKumaInstances.$.encryptedPassword'] = encryptUptimeKumaSecretOrUnavailable(
            patch.password,
          )
        }
        if (patchUsesPasswordAuth) unset['uptimeKumaInstances.$.encryptedAuthToken'] = ''
      }

      const update: { $set: Record<string, unknown>; $unset?: Record<string, ''> } = { $set: set }

      if (Object.keys(unset).length > 0) update.$unset = unset

      await teamByosBindings().updateOne(
        { _id: teamId, 'uptimeKumaInstances.id': instanceId },
        update,
      )
      const doc = await teamByosBindings().findOne(
        { _id: teamId },
        { projection: { uptimeKumaInstances: 1 } },
      )
      const updated = doc?.uptimeKumaInstances?.find((item) => item.id.equals(instanceId))

      if (!updated) {
        throw new AppError(404, 'uptime_kuma_instance_not_bound', 'Uptime Kuma instance not found')
      }

      return c.json(publicView(updated))
    },
  )

  instanceScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const instanceId = new ObjectId(c.get('uptimeKumaInstanceId'))
    const result = await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $pull: { uptimeKumaInstances: { id: instanceId } },
        $set: { updatedAt: new Date() },
      },
    )

    if (result.modifiedCount === 0) {
      throw new AppError(404, 'uptime_kuma_instance_not_bound', 'Uptime Kuma instance not found')
    }

    return c.body(null, 204)
  })

  instanceScoped.get('/credentials', requireTeamRole('ADMINISTRATOR'), (c) => {
    const binding = c.get('uptimeKumaBinding')

    return c.json({
      id: c.get('uptimeKumaInstanceId'),
      instanceId: c.get('uptimeKumaInstanceId'),
      label: binding.label,
      baseUrl: binding.baseUrl,
      username: binding.username ?? null,
      password: binding.encryptedPassword
        ? decryptUptimeKumaSecret(binding.encryptedPassword)
        : null,
      authToken: binding.encryptedAuthToken
        ? decryptUptimeKumaSecret(binding.encryptedAuthToken)
        : null,
    })
  })
}
