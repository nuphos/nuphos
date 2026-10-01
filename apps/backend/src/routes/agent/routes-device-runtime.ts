import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/bun'
import { z } from 'zod'

import { conversationTitlesFor } from '@/lib/agent/devices/audit'
import {
  decodeActivityCursor,
  listLocalRuntimeActivity,
} from '@/lib/agent/devices/local-runtime/activity'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { attachRuntimeTunnel } from '@/lib/agent/devices/local-runtime/holder'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { getAgentDevice, isActiveTeamMember } from '@/lib/agent/devices/store'
import { setLocalAgentDefaults } from '@/lib/claude-code-preview/local-agent-defaults'
import { runtimeDefaultsSchema } from '@/lib/claude-code-preview/runtime-defaults'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
import { zv } from '@/lib/validate'

import { agent } from './router'

import type { LocalRuntimeActivityPage } from '@/lib/agent/devices/local-runtime/activity'
import type { RuntimeTunnel, TunnelHolderDeps } from '@/lib/agent/devices/local-runtime/holder'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { RuntimeDefaults } from '@/lib/claude-code-preview/runtime-defaults'
import type { NuphosTeamMember } from '@/lib/identity'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'
import type { WSContext } from 'hono/ws'

export type DeviceRuntimeRouteDependencies = {
  getAgentDevice: (userId: string, deviceId: string) => Promise<AgentDevice | null>
  holder: TunnelHolderDeps
  listActivity: (
    ownerUserId: string,
    deviceId: string,
    options: { limit: number; cursor?: string },
  ) => Promise<LocalRuntimeActivityPage>
  conversationTitlesFor: (sessionIds: string[]) => Promise<Map<string, string>>
  getTeamMembers: (teamId: string) => Promise<NuphosTeamMember[]>
  setLocalAgentDefaults: (runtimeId: string, defaults: RuntimeDefaults) => Promise<void>
}

function defaultDependencies(): DeviceRuntimeRouteDependencies {
  return {
    getAgentDevice,
    holder: {
      bus: tunnelBus(),
      presence: runtimePresenceStore(),
      isMember: isActiveTeamMember,
    },
    listActivity: listLocalRuntimeActivity,
    conversationTitlesFor,
    getTeamMembers: (teamId) => getTeamMembers(teamId),
    setLocalAgentDefaults,
  }
}

const deviceParam = z.object({ deviceId: z.string().trim().min(1).max(128) })
const activityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z
    .string()
    .max(100)
    .refine((value) => decodeActivityCursor(value) !== null, 'Invalid cursor')
    .optional(),
})

function tunnelEvents(userId: string, deviceId: string, deps: TunnelHolderDeps) {
  let tunnel: Promise<RuntimeTunnel> | undefined

  return {
    onOpen: (_event: Event, ws: WSContext) => {
      tunnel = attachRuntimeTunnel(
        userId,
        deviceId,
        {
          send: (frame) => {
            ws.send(JSON.stringify(frame))
          },
          close: (code, reason) => {
            ws.close(code, reason)
          },
        },
        deps,
      )
      tunnel.catch(() => {
        ws.close(1011, 'Could not open the runtime tunnel')
      })
    },
    onMessage: (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      const data = event.data

      void tunnel?.then((attached) => {
        attached.receive(data)
      })
    },
    onClose: () => {
      void tunnel?.then((attached) => {
        attached.closed()
      })
    },
  }
}

export function createDeviceRuntimeRoutes(
  deps: DeviceRuntimeRouteDependencies = defaultDependencies(),
) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  async function requireOwnDevice(userId: string, deviceId: string): Promise<void> {
    if (!(await deps.getAgentDevice(userId, deviceId)))
      throw new AppError(404, 'device_not_found', 'Device is not registered')
  }

  // Connecting only makes the computer reachable; only its owner can open streams on it.
  routes.get('/devices/:deviceId/runtime-tunnel', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const { deviceId } = c.req.valid('param')

    await requireOwnDevice(userId, deviceId)
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      throw new AppError(426, 'upgrade_required', 'Connect with a WebSocket')

    return upgradeWebSocket(c as unknown as Context, tunnelEvents(userId, deviceId, deps.holder))
  })

  routes.get(
    '/devices/:deviceId/runtime-activity',
    zv('param', deviceParam),
    zv('query', activityQuery),
    async (c) => {
      const userId = c.get('userId')
      const { deviceId } = c.req.valid('param')
      const { limit, before } = c.req.valid('query')

      await requireOwnDevice(userId, deviceId)
      const page = await deps.listActivity(userId, deviceId, {
        limit,
        ...(before ? { cursor: before } : {}),
      })
      const teamIds = [...new Set(page.entries.map((entry) => entry.teamId))]
      const [titles, rosters] = await Promise.all([
        deps.conversationTitlesFor([...new Set(page.entries.map((entry) => entry.sessionId))]),
        Promise.all(teamIds.map((teamId) => deps.getTeamMembers(teamId))),
      ])
      const names = new Map(
        rosters.flat().map((member) => [member.id, member.name || member.username || member.email]),
      )

      return c.json({
        entries: page.entries.map((entry) => ({
          id: entry._id?.toHexString() ?? `${entry.sessionId}:${entry.lastServedAt.toISOString()}`,
          teamId: entry.teamId,
          sessionId: entry.sessionId,
          conversationTitle: titles.get(entry.sessionId) ?? null,
          actorUserId: entry.lastActorUserId,
          actorName: names.get(entry.lastActorUserId) ?? null,
          firstServedAt: entry.firstServedAt.toISOString(),
          lastServedAt: entry.lastServedAt.toISOString(),
          turns: entry.turns,
        })),
        nextCursor: page.nextCursor,
      })
    },
  )

  routes.put(
    '/local-agents/:runtimeId/defaults',
    zv('param', z.object({ runtimeId: z.string().trim().min(1).max(300) })),
    zv('json', runtimeDefaultsSchema),
    async (c) => {
      const { runtimeId } = c.req.valid('param')

      if (parseLocalRuntimeId(runtimeId)?.userId !== c.get('userId'))
        throw new AppError(404, 'runtime_not_found', 'This agent is not one of yours')
      await deps.setLocalAgentDefaults(runtimeId, c.req.valid('json'))

      return c.json({ ok: true })
    },
  )

  return routes
}

agent.route('/', createDeviceRuntimeRoutes())
