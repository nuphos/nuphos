import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'
import { z } from 'zod'

import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { createLocalAgentInstance } from '@/lib/agent/devices/local-runtime/instances'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { LOCAL_AGENT_PROVIDERS } from '@/lib/agent/devices/local-runtime/protocol'
import { isActiveTeamMember } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { isTeamIdShape } from '@/lib/team-id'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate } from './team-scope'

import type { AuthVariables } from '@/middleware/auth'

const createSchema = z.object({
  teamId: z.string().trim().min(1).max(64).optional(),
  provider: z.enum(LOCAL_AGENT_PROVIDERS),
  label: z.string().trim().min(1).max(100).optional(),
  // A retry keeps the same id, so a lost response never creates a duplicate.
  instanceId: z.string().uuid().optional(),
})

export type DeviceAgentRouteDeps = {
  requireAccess: typeof requireDeviceAccess
  isMember: typeof isActiveTeamMember
  getPresence: ReturnType<typeof runtimePresenceStore>['get']
  createInstance: typeof createLocalAgentInstance
}

export function createDeviceAgentRoutes(
  deps: DeviceAgentRouteDeps = {
    requireAccess: requireDeviceAccess,
    isMember: isActiveTeamMember,
    getPresence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
    createInstance: createLocalAgentInstance,
  },
) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.post('/devices/:deviceId/agents', zv('json', createSchema), async (c) => {
    const userId = c.get('userId')
    const deviceId = c.req.param('deviceId')
    const body = c.req.valid('json')
    const teamId = readTeamIdCandidate(c, body.teamId)

    if (!teamId || !isTeamIdShape(teamId) || !(await deps.isMember(userId, teamId)))
      throw new AppError(404, 'device_not_found', 'Device is not available in this team')
    const device = await deps.requireAccess(userId, teamId, deviceId, 'manage')
    const presence = await deps.getPresence(device.userId, deviceId)

    if (presence?.status?.agentInstances !== true)
      throw new AppError(
        409,
        'agent_instances_unavailable',
        'Update and connect the Box host before adding another agent.',
      )
    const instance = await deps.createInstance(
      { userId: device.userId, actorId: userId, deviceId, teamId },
      {
        instanceId: body.instanceId ?? randomUUID(),
        provider: body.provider,
        label: body.label ?? (body.provider === 'codex' ? 'Codex' : 'Claude Code'),
      },
    )

    return c.json(
      {
        ...instance,
        runtimeId: localRuntimeId({ userId: device.userId, deviceId, ...instance }),
      },
      201,
    )
  })

  return routes
}
