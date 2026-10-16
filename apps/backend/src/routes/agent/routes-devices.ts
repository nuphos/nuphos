import { Hono } from 'hono'
import { z } from 'zod'

import {
  conversationTitlesFor,
  decodeAuditCursor,
  listDeviceExecAudit,
} from '@/lib/agent/devices/audit'
import {
  deviceAccessDeps,
  requireDeviceAccess,
  revokeBoxStreams,
} from '@/lib/agent/devices/box-access'
import {
  boxBackendUrl,
  boxDesktopUrl,
  boxState,
  boxesAvailable,
  boxesEnabled,
  createBox,
  destroyBox,
  healBox,
  pauseBox,
  resumeBox,
} from '@/lib/agent/devices/box-instabox'
import {
  DEVICE_JOIN_TOKEN_DEFAULT_TTL_SEC,
  DEVICE_JOIN_TOKEN_MAX_TTL_SEC,
  issueDeviceJoinToken,
} from '@/lib/agent/devices/join-tokens'
import { readBoxMetrics } from '@/lib/agent/devices/box-metrics'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { holderChannel } from '@/lib/agent/devices/local-runtime/protocol'
import { isDevicePresent } from '@/lib/agent/devices/presence'
import {
  deleteAgentDevice,
  getAgentDevice,
  listAgentDevicesForUser,
  renameAgentDevice,
  revokeAgentDeviceCredential,
  upsertAgentDevice,
  setBoxAccess,
} from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
import { zv } from '@/lib/validate'

import { agent } from './router'
import { createAgentDeviceBoxRoutes } from './routes-devices-box'
import { createDeviceAgentRoutes } from './routes-device-agents'
import { readTeamIdCandidate } from './team-scope'

import type { DeviceExecAuditPage } from '@/lib/agent/devices/audit'
import type { DeviceAccessDeps } from '@/lib/agent/devices/box-access'
import type { BoxState } from '@/lib/agent/devices/box-instabox'
import type { HolderMessage } from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentDevice, AgentDeviceRegistration } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

const deviceRegistrationSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(64).optional(),
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
  access: DeviceAccessDeps
  setBoxAccess: (
    userId: string,
    deviceId: string,
    access: { everyone: boolean; userIds: string[] },
  ) => Promise<boolean>
  teamMembers: (teamId: string) => Promise<{ id: string; role: string }[]>
  revokeStreams: (devices: AgentDevice[], actorIds: string[]) => Promise<void>
  readMetrics: typeof readBoxMetrics
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
  listDevices: (userId: string) => Promise<AgentDevice[]>
  isOnline: (userId: string, deviceId: string) => Promise<boolean>
  deleteDevice: (userId: string, deviceId: string) => Promise<boolean>
  renameDevice: (userId: string, deviceId: string, label: string) => Promise<boolean>
  /** Where a joining machine dials: this deployment's public URL, if it has one. */
  publicUrl: () => string | undefined
  /** Null when this deployment has no Box provider. */
  box: {
    create: (userId: string, teamId: string, label: string) => Promise<AgentDevice>
    pause: (userId: string, deviceId: string) => Promise<AgentDevice>
    resume: (userId: string, deviceId: string) => Promise<AgentDevice>
    destroy: (userId: string, deviceId: string) => Promise<void>
    /** A link to the Box's desktop, to watch and take over what its agents do. */
    desktop: (userId: string, deviceId: string) => Promise<string>
    /** Starts the host again on a running machine whose host dropped; rate-limited. */
    heal: (userId: string, deviceId: string) => void
    /** Whether Boxes can be ordered here: a provider and a public URL for the machine to dial. */
    available: () => boolean
    state: (device: AgentDevice, online: boolean) => Promise<BoxState | 'gone'>
  } | null
}

const defaultDependencies: AgentDeviceRouteDependencies = {
  access: deviceAccessDeps,
  setBoxAccess,
  teamMembers: (teamId) => getTeamMembers(teamId),
  revokeStreams: revokeBoxStreams,
  readMetrics: (userId, deviceId, demand) => readBoxMetrics(userId, deviceId, demand),
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
  listDevices: listAgentDevicesForUser,
  isOnline: isDevicePresent,
  deleteDevice: deleteAgentDevice,
  renameDevice: renameAgentDevice,
  publicUrl: boxBackendUrl,
  box: boxesEnabled()
    ? {
        create: createBox,
        pause: pauseBox,
        resume: resumeBox,
        destroy: destroyBox,
        desktop: boxDesktopUrl,
        heal: healBox,
        available: boxesAvailable,
        state: boxState,
      }
    : null,
}

export function createAgentDeviceRoutes(deps: AgentDeviceRouteDependencies = defaultDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.route('/', createAgentDeviceBoxRoutes(deps))
  routes.route('/', createDeviceAgentRoutes())

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

    // Where the joining machine dials: this deployment's public URL.
    return c.json(
      { token, expiresAt: expiresAt.toISOString(), apiUrl: deps.publicUrl() ?? null },
      201,
    )
  })

  // Revokes the credential a join token gave this device and drops its tunnel.
  routes.delete(
    '/devices/:deviceId/credential',
    zv('param', z.object({ deviceId: z.string().trim().min(1).max(128) })),
    async (c) => {
      const { deviceId } = c.req.valid('param')
      const { userId } = await requireDeviceAccess(
        c.get('userId'),
        readTeamIdCandidate(c),
        deviceId,
        'manage',
        deps.access,
      )

      if (!(await deps.revokeCredential(userId, deviceId)))
        throw new AppError(404, 'credential_not_found', 'This device has no credential to revoke')
      await deps.disconnect(userId, deviceId)

      return c.json({ ok: true })
    },
  )

  // Forgets an offline computer, credential and agents with it; opening Nuphos there registers it
  // again. Online, it would just re-register, so it must be quit first. A Box has its own delete.
  routes.delete(
    '/devices/:deviceId',
    zv('param', z.object({ deviceId: z.string().trim().min(1).max(128) })),
    async (c) => {
      const userId = c.get('userId')
      const { deviceId } = c.req.valid('param')
      const device = await deps.getAgentDevice(userId, deviceId)

      if (!device) throw new AppError(404, 'device_not_found', 'Device is not registered')
      if (device.box) throw new AppError(400, 'device_is_box', 'Delete a Box with its Box delete')
      if (await deps.isOnline(userId, deviceId))
        throw new AppError(409, 'device_online', 'Quit Nuphos on this computer first')
      await deps.deleteDevice(userId, deviceId)
      // In case it connected since the check: its credential is gone, so close what it holds.
      await deps.disconnect(userId, deviceId)

      return c.json({ ok: true })
    },
  )

  routes.get(
    '/devices/:deviceId/audit',
    zv('param', z.object({ deviceId: z.string().trim().min(1).max(128) })),
    zv('query', auditQuerySchema),
    async (c) => {
      const { deviceId } = c.req.valid('param')
      const { userId } = await requireDeviceAccess(
        c.get('userId'),
        readTeamIdCandidate(c),
        deviceId,
        'manage',
        deps.access,
      )
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
