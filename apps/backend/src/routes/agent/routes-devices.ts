import { Hono } from 'hono'
import { z } from 'zod'

import {
  conversationTitlesFor,
  decodeAuditCursor,
  listDeviceExecAudit,
} from '@/lib/agent/devices/audit'
import { mergeAgentDevice } from '@/lib/agent/devices/merge'
import { getAgentDevice, upsertAgentDevice } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { agent } from './router'

import type { DeviceExecAuditPage } from '@/lib/agent/devices/audit'
import type { AgentDevice, AgentDeviceRegistration } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

const deviceRegistrationSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(64),
  allowLocalExec: z.boolean(),
  // Ids this computer registered under before its stable one.
  previousDeviceIds: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
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
  mergeAgentDevice: (userId: string, fromId: string, toId: string) => Promise<boolean>
  getAgentDevice: (userId: string, deviceId: string) => Promise<AgentDevice | null>
  listDeviceExecAudit: (
    ownerUserId: string,
    deviceId: string,
    options: { limit: number; cursor?: string },
  ) => Promise<DeviceExecAuditPage>
  conversationTitlesFor: (sessionIds: string[]) => Promise<Map<string, string>>
}

const defaultDependencies: AgentDeviceRouteDependencies = {
  upsertAgentDevice,
  mergeAgentDevice,
  getAgentDevice,
  listDeviceExecAudit,
  conversationTitlesFor,
}

export function createAgentDeviceRoutes(deps: AgentDeviceRouteDependencies = defaultDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.put('/devices', zv('json', deviceRegistrationSchema), async (c) => {
    const userId = c.get('userId')
    const { previousDeviceIds = [], ...device } = c.req.valid('json')

    await deps.upsertAgentDevice(userId, device)
    for (const previous of previousDeviceIds)
      await deps.mergeAgentDevice(userId, previous, device.deviceId)

    return c.json({ ok: true })
  })

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
