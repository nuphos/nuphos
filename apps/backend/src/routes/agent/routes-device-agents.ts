import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'
import { z } from 'zod'

import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import {
  createLocalAgentInstance,
  removeLocalAgentInstance,
} from '@/lib/agent/devices/local-runtime/instances'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { LOCAL_AGENT_PROVIDERS } from '@/lib/agent/devices/local-runtime/protocol'
import { isActiveTeamMember, removeDeviceAgent, renameDeviceAgent } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { isTeamIdShape } from '@/lib/team-id'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate } from './team-scope'

import type { RemovableAgent } from '@/lib/agent/devices/local-runtime/protocol'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

const createSchema = z.object({
  teamId: z.string().trim().min(1).max(64).optional(),
  provider: z.enum(LOCAL_AGENT_PROVIDERS),
  label: z.string().trim().min(1).max(100).optional(),
  // A retry keeps the same id, so a lost response never creates a duplicate.
  instanceId: z.string().uuid().optional(),
})

// An empty label gives the agent back its default name.
const renameSchema = z.object({
  teamId: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().max(100),
})

export type DeviceAgentRouteDeps = {
  requireAccess: typeof requireDeviceAccess
  isMember: typeof isActiveTeamMember
  getPresence: ReturnType<typeof runtimePresenceStore>['get']
  createInstance: typeof createLocalAgentInstance
  removeInstance: typeof removeLocalAgentInstance
  forgetAgent: typeof removeDeviceAgent
  renameAgent: typeof renameDeviceAgent
}

export function createDeviceAgentRoutes(
  deps: DeviceAgentRouteDeps = {
    requireAccess: requireDeviceAccess,
    isMember: isActiveTeamMember,
    getPresence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
    createInstance: createLocalAgentInstance,
    removeInstance: removeLocalAgentInstance,
    forgetAgent: removeDeviceAgent,
    renameAgent: renameDeviceAgent,
  },
) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  const managed = async (c: Context<{ Variables: AuthVariables }>, candidate?: string) => {
    const userId = c.get('userId')
    const deviceId = c.req.param('deviceId') ?? ''
    const teamId = readTeamIdCandidate(c, candidate)

    if (!teamId || !isTeamIdShape(teamId) || !(await deps.isMember(userId, teamId)))
      throw new AppError(404, 'device_not_found', 'Device is not available in this team')

    return {
      userId,
      deviceId,
      teamId,
      device: await deps.requireAccess(userId, teamId, deviceId, 'manage'),
    }
  }

  /** Adding or removing an agent manages the Box, and needs a host that supports it. */
  const managedDevice = async (c: Context<{ Variables: AuthVariables }>, candidate?: string) => {
    const { userId, deviceId, teamId, device } = await managed(c, candidate)
    const presence = await deps.getPresence(device.userId, deviceId)

    if (presence?.status?.agentInstances !== true)
      throw new AppError(
        409,
        'agent_instances_unavailable',
        'Update and connect the Box host before adding another agent.',
      )

    return { target: { userId: device.userId, actorId: userId, deviceId, teamId }, device }
  }

  routes.post('/devices/:deviceId/agents', zv('json', createSchema), async (c) => {
    const body = c.req.valid('json')
    const { target, device } = await managedDevice(c, body.teamId)
    const { deviceId } = target
    const instance = await deps.createInstance(target, {
      instanceId: body.instanceId ?? randomUUID(),
      provider: body.provider,
      label: body.label ?? (body.provider === 'codex' ? 'Codex' : 'Claude Code'),
    })

    return c.json(
      {
        ...instance,
        runtimeId: localRuntimeId({ userId: device.userId, deviceId, ...instance }),
      },
      201,
    )
  })

  // Names live in the device's agent registry, so this works with the computer offline.
  // `:agent` is an added agent's instance id, or the provider for the computer's own.
  routes.patch('/devices/:deviceId/agents/:agent', zv('json', renameSchema), async (c) => {
    const { teamId, label } = c.req.valid('json')
    const { device, deviceId } = await managed(c, teamId)

    if (!(await deps.renameAgent(device.userId, deviceId, c.req.param('agent'), label)))
      throw new AppError(404, 'agent_not_found', 'This agent is not registered on that computer.')

    return c.json({ ok: true })
  })

  // `:agent` as for rename. A person's own computer keeps its defaults: their logins are
  // that person's CLI logins.
  routes.delete('/devices/:deviceId/agents/:agent', async (c) => {
    const id = c.req.param('agent')
    const provider = z.enum(LOCAL_AGENT_PROVIDERS).safeParse(id)
    const agent: RemovableAgent | undefined = z.string().uuid().safeParse(id).success
      ? { instanceId: id }
      : provider.success
        ? { provider: provider.data }
        : undefined

    if (!agent) throw new AppError(400, 'agent_not_removable', 'This agent cannot be removed.')
    const { target, device } = await managedDevice(c)

    if ('provider' in agent && !device.box)
      throw new AppError(
        400,
        'agent_not_removable',
        "Only a Box's default agents can be removed; this computer's stay with its CLIs.",
      )
    await deps.removeInstance(target, agent)
    // Removing is the only way an agent leaves the list once it has been signed in.
    await deps.forgetAgent(target.userId, target.deviceId, agent)

    return c.body(null, 204)
  })

  return routes
}
