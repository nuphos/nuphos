import { Hono } from 'hono'
import { z } from 'zod'

import { listDeviceAccessAudit } from '@/lib/agent/devices/access-audit'
import { decodeAuditCursor } from '@/lib/agent/devices/audit'
import { deviceAccessDeps, requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate } from './team-scope'

import type { DeviceAccessDeps } from '@/lib/agent/devices/box-access'
import type { AuthVariables } from '@/middleware/auth'

const accessAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z
    .string()
    .max(100)
    .refine((value) => decodeAuditCursor(value) !== null, 'Invalid cursor')
    .optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
})

export type DeviceAccessAuditRouteDependencies = {
  access: DeviceAccessDeps
  listDeviceAccessAudit: typeof listDeviceAccessAudit
}

export function createDeviceAccessAuditRoutes(
  deps: DeviceAccessAuditRouteDependencies = {
    access: deviceAccessDeps,
    listDeviceAccessAudit,
  },
) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  // Who changed who may use the computer, for its owner and managers: this computer, this team.
  routes.get(
    '/devices/:deviceId/access-audit',
    zv('param', z.object({ deviceId: z.string().trim().min(1).max(128) })),
    zv('query', accessAuditQuerySchema),
    async (c) => {
      const teamId = readTeamIdCandidate(c)

      if (!teamId) throw new AppError(400, 'team_required', 'Pass the teamId to read it for')
      const device = await requireDeviceAccess(
        c.get('userId'),
        teamId,
        c.req.valid('param').deviceId,
        'manage',
        deps.access,
      )
      const { limit, before, since, until } = c.req.valid('query')
      const page = await deps.listDeviceAccessAudit(
        { ownerUserId: device.userId, deviceId: device.deviceId, teamId },
        {
          limit,
          ...(before ? { cursor: before } : {}),
          ...(since ? { since: new Date(since) } : {}),
          ...(until ? { until: new Date(until) } : {}),
        },
      )

      return c.json({
        entries: page.entries.map((entry) => ({
          id: entry._id?.toHexString() ?? null,
          deviceId: entry.deviceId,
          teamId: entry.teamId,
          actorUserId: entry.actorUserId,
          actorAuthority: entry.actorAuthority,
          via: entry.via,
          previous: entry.previous,
          next: entry.next,
          changedAt: entry.changedAt.toISOString(),
        })),
        nextCursor: page.nextCursor,
      })
    },
  )

  return routes
}
