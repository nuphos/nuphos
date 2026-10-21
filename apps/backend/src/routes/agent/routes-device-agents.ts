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
import {
  forgetAgentAddition,
  recordAgentAddition,
  removeDeviceAgent,
  renameDeviceAgent,
} from '@/lib/agent/devices/agent-registry-store'
import { isActiveTeamMember } from '@/lib/agent/devices/store'
import { runtimeLabel } from '@/lib/claude-code-preview/runtime-provider'
import { AppError } from '@/lib/errors'
import { isTeamIdShape } from '@/lib/team-id'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate } from './team-scope'

import type { DeviceAccessLevel } from '@/lib/agent/devices/box-access'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'
import type { RemovableAgent } from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentDevice } from '@/lib/agent/devices/store'
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
  recordAddition: typeof recordAgentAddition
  forgetAddition: typeof forgetAgentAddition
}

type HostDevice = {
  target: { userId: string; actorId: string; deviceId: string; teamId: string }
  device: AgentDevice
  presence: LocalRuntimePresence
}

/** An agent the host already has, signed in or still pending. */
function existingAgent({ device, presence }: HostDevice, instanceId: string): boolean {
  return (
    device.agents?.some((agent) => agent.instanceId === instanceId) === true ||
    presence.status?.instances?.some((instance) => instance.instanceId === instanceId) === true
  )
}

/** The caller added this agent and it never signed in, so cancelling its setup may remove it. */
function ownPendingAgent({ device, presence, target }: HostDevice, instanceId: string): boolean {
  const reported = presence.status?.instances?.find(
    (instance) => instance.instanceId === instanceId,
  )

  return (
    device.addedAgents?.some(
      (entry) => entry.instanceId === instanceId && entry.userId === target.actorId,
    ) === true &&
    !device.agents?.some((agent) => agent.instanceId === instanceId) &&
    // An older host reports no state, so only a reported pending one counts.
    (!reported || reported.state === 'pending')
  )
}

const isNotFound = (error: unknown) =>
  error instanceof Error && 'status' in error && error.status === 404

export function createDeviceAgentRoutes(
  deps: DeviceAgentRouteDeps = {
    requireAccess: requireDeviceAccess,
    isMember: isActiveTeamMember,
    getPresence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
    createInstance: createLocalAgentInstance,
    removeInstance: removeLocalAgentInstance,
    forgetAgent: removeDeviceAgent,
    renameAgent: renameDeviceAgent,
    recordAddition: recordAgentAddition,
    forgetAddition: forgetAgentAddition,
  },
) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  const authorized = async (
    c: Context<{ Variables: AuthVariables }>,
    level: DeviceAccessLevel,
    candidate?: string,
  ) => {
    const userId = c.get('userId')
    const deviceId = c.req.param('deviceId') ?? ''
    const teamId = readTeamIdCandidate(c, candidate)

    if (!teamId || !isTeamIdShape(teamId) || !(await deps.isMember(userId, teamId)))
      throw new AppError(404, 'device_not_found', 'Device is not available in this team')

    return {
      userId,
      deviceId,
      teamId,
      device: await deps.requireAccess(userId, teamId, deviceId, level),
    }
  }

  /** Adding an agent is for anyone the Box is shared with, removing one for its managers;
   *  both need a host that supports it. */
  const hostDevice = async (
    c: Context<{ Variables: AuthVariables }>,
    level: DeviceAccessLevel,
    candidate?: string,
  ): Promise<HostDevice> => {
    const { userId, deviceId, teamId, device } = await authorized(c, level, candidate)
    const presence = await deps.getPresence(device.userId, deviceId)

    if (presence?.status?.agentInstances !== true)
      throw new AppError(
        409,
        'agent_instances_unavailable',
        'Update and connect the Box host before adding another agent.',
      )

    return {
      target: { userId: device.userId, actorId: userId, deviceId, teamId },
      device,
      presence,
    }
  }

  routes.post('/devices/:deviceId/agents', zv('json', createSchema), async (c) => {
    const body = c.req.valid('json')
    const host = await hostDevice(c, 'use', body.teamId)
    const { target, device } = host
    const { deviceId } = target
    const instanceId = body.instanceId ?? randomUUID()
    // The host answers an id it has as a retry, so only a new agent is noted, and before the
    // host makes it: a status report then never lists the agent without its addition.
    const added = !existingAgent(host, instanceId)

    if (added)
      await deps.recordAddition(device.userId, deviceId, {
        instanceId,
        userId: target.actorId,
        at: new Date(),
      })
    let instance: Awaited<ReturnType<typeof deps.createInstance>>

    try {
      instance = await deps.createInstance(target, {
        instanceId,
        provider: body.provider,
        label: body.label ?? runtimeLabel(body.provider),
      })
    } catch (error) {
      if (added) await deps.forgetAddition(device.userId, deviceId, instanceId)
      throw error
    }

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
    const { device, deviceId } = await authorized(c, 'manage', teamId)

    if (!(await deps.renameAgent(device.userId, deviceId, c.req.param('agent'), label)))
      throw new AppError(404, 'agent_not_found', 'This agent is not registered on that computer.')

    return c.json({ ok: true })
  })

  /** Managers remove any agent; whoever added one may remove it until it has signed in. */
  const removableBy = async (c: Context<{ Variables: AuthVariables }>, agent: RemovableAgent) => {
    try {
      return await hostDevice(c, 'manage')
    } catch (error) {
      if (!('instanceId' in agent) || !isNotFound(error)) throw error
      const host = await hostDevice(c, 'use')

      if (!ownPendingAgent(host, agent.instanceId)) throw error

      return host
    }
  }

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
    const { target, device } = await removableBy(c, agent)

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
