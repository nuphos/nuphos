import { Hono } from 'hono'
import { z } from 'zod'

import {
  conversationTitlesFor,
  decodeAuditCursor,
  listDeviceExecAudit,
} from '@/lib/agent/devices/audit'
import {
  DEVICE_JOIN_TOKEN_DEFAULT_TTL_SEC,
  DEVICE_JOIN_TOKEN_MAX_TTL_SEC,
  issueDeviceJoinToken,
} from '@/lib/agent/devices/join-tokens'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { holderChannel } from '@/lib/agent/devices/local-runtime/protocol'
import {
  getAgentDevice,
  revokeAgentDeviceCredential,
  upsertAgentDevice,
} from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { agent } from './router'

import type { DeviceExecAuditPage } from '@/lib/agent/devices/audit'
import type { HolderMessage } from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentDevice, AgentDeviceRegistration } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

const deviceRegistrationSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(64),
  allowLocalExec: z.boolean(),
})

const joinTokenSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  expiresInSec: z
    .number()
    .int()
    .min(60)
    .max(DEVICE_JOIN_TOKEN_MAX_TTL_SEC)
    .default(DEVICE_JOIN_TOKEN_DEFAULT_TTL_SEC),
})

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z
    .string()
    .max(100)
    .refine((value) => decodeAuditCursor(value) !== null, 'Invalid cursor')
    .optional(),
})

export type AgentDeviceRouteDependencies = {
  upsertAgentDevice: (userId: string, device: AgentDeviceRegistration) => Promise<void>
  getAgentDevice: (userId: string, deviceId: string) => Promise<AgentDevice | null>
  listDeviceExecAudit: (
    ownerUserId: string,
    deviceId: string,
    options: { limit: number; cursor?: string },
  ) => Promise<DeviceExecAuditPage>
  conversationTitlesFor: (sessionIds: string[]) => Promise<Map<string, string>>
  issueJoinToken: typeof issueDeviceJoinToken
  revokeCredential: (userId: string, deviceId: string) => Promise<boolean>
  disconnect: (userId: string, deviceId: string) => Promise<void>
}

const defaultDependencies: AgentDeviceRouteDependencies = {
  upsertAgentDevice,
  getAgentDevice,
  issueJoinToken: issueDeviceJoinToken,
  revokeCredential: revokeAgentDeviceCredential,
  disconnect: async (userId, deviceId) => {
    await tunnelBus().publish(
      holderChannel(userId, deviceId),
      JSON.stringify({ t: 'revoke' } satisfies HolderMessage),
    )
  },
  listDeviceExecAudit,
  conversationTitlesFor,
}

export function createAgentDeviceRoutes(deps: AgentDeviceRouteDependencies = defaultDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.put('/devices', zv('json', deviceRegistrationSchema), async (c) => {
    await deps.upsertAgentDevice(c.get('userId'), c.req.valid('json'))

    return c.json({ ok: true })
  })

  // One-time token for `nuphos agent --join`: the machine that uses it becomes
  // this user's device, as if they had signed in there.
  routes.post('/devices/join-tokens', zv('json', joinTokenSchema), async (c) => {
    const { label, expiresInSec } = c.req.valid('json')
    const { token, expiresAt } = await deps.issueJoinToken(c.get('userId'), {
      ...(label ? { label } : {}),
      expiresInSec,
    })

    return c.json({ token, expiresAt: expiresAt.toISOString() }, 201)
  })

  // Revokes the credential a join token gave this device and drops its tunnel.
  routes.delete(
    '/devices/:deviceId/credential',
    zv('param', z.object({ deviceId: z.string().trim().min(1).max(128) })),
    async (c) => {
      const userId = c.get('userId')
      const { deviceId } = c.req.valid('param')

      if (!(await deps.revokeCredential(userId, deviceId)))
        throw new AppError(404, 'credential_not_found', 'This device has no credential to revoke')
      await deps.disconnect(userId, deviceId)

      return c.json({ ok: true })
    },
  )

  routes.get(
    '/devices/:deviceId/audit',
    zv('param', z.object({ deviceId: z.string().trim().min(1).max(128) })),
    zv('query', auditQuerySchema),
    async (c) => {
      const userId = c.get('userId')
      const { deviceId } = c.req.valid('param')
      const { limit, before } = c.req.valid('query')
      const device = await deps.getAgentDevice(userId, deviceId)

      if (!device) throw new AppError(404, 'device_not_found', 'Device is not registered')
      const page = await deps.listDeviceExecAudit(userId, deviceId, {
        limit,
        ...(before ? { cursor: before } : {}),
      })
      const titles = await deps.conversationTitlesFor([
        ...new Set(page.entries.map((entry) => entry.sessionId)),
      ])

      return c.json({
        entries: page.entries.map((entry) => ({
          id: entry._id?.toHexString() ?? `${entry.sessionId}:${entry.requestedAt.toISOString()}`,
          deviceId: entry.deviceId,
          actorUserId: entry.actorUserId,
          conversationOwnerUserId: entry.conversationOwnerUserId,
          origin: entry.origin,
          teamId: entry.teamId,
          sessionId: entry.sessionId,
          conversationTitle: titles.get(entry.sessionId) ?? null,
          command: entry.command,
          commandRedacted: entry.commandRedacted,
          requestedAt: entry.requestedAt.toISOString(),
          dispatchedAt: entry.dispatchedAt?.toISOString() ?? null,
          finishedAt: entry.finishedAt.toISOString(),
          durationMs: entry.durationMs,
          outcome: entry.outcome,
          exitCode: entry.exitCode ?? null,
          reason: entry.reason ?? null,
        })),
        nextCursor: page.nextCursor,
      })
    },
  )

  return routes
}

agent.route('/', createAgentDeviceRoutes())
