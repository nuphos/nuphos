import { Hono } from 'hono'
import { z } from 'zod'

import { readBoxMetrics } from '@/lib/agent/devices/box-metrics'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

import type { AgentDeviceRouteDependencies } from './routes-devices'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

// Boxes: cloud machines made for the caller, listed and driven as their devices.

const deviceParam = z.object({ deviceId: z.string().trim().min(1).max(128) })
const boxCreateSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  teamId: z.string().trim().min(1).max(64).optional(),
})

/** Unnamed Boxes count up: "Box 1", "Box 2", … after the highest the caller has. */
export function nextBoxLabel(labels: string[]): string {
  const taken = labels
    .map((label) => /^Box (\d+)$/u.exec(label)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)

  return `Box ${String(Math.max(0, ...taken) + 1)}`
}

/** What a client sees of a device: never the credential hash. */
/** Null when the Box's machine no longer exists; the row is dropped with it. */
async function deviceView(
  deps: AgentDeviceRouteDependencies,
  device: AgentDevice,
  /** Right after a pause the frozen tunnel still looks alive; the caller knows better. */
  online?: boolean,
) {
  online ??= await deps.isOnline(device.userId, device.deviceId)
  const state = device.box && deps.box ? await deps.box.state(device, online) : undefined

  if (state === 'gone') {
    await deps.deleteDevice(device.userId, device.deviceId)

    return null
  }

  return {
    deviceId: device.deviceId,
    label: device.label,
    platform: device.platform,
    ...(device.model ? { model: device.model } : {}),
    allowLocalExec: device.allowLocalExec,
    online,
    createdAt: device.createdAt.toISOString(),
    ...(device.box && state
      ? {
          box: {
            provider: device.box.provider,
            ...(device.box.sandboxId ? { sandboxId: device.box.sandboxId } : {}),
            state,
          },
        }
      : {}),
  }
}

export function createAgentDeviceBoxRoutes(deps: AgentDeviceRouteDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  const viewOrGone = async (device: AgentDevice, online?: boolean) => {
    const view = await deviceView(deps, device, online)

    if (!view) throw new AppError(404, 'not_found', 'This Box no longer exists')

    return view
  }
  const requireBoxes = () => {
    if (!deps.box)
      throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

    return deps.box
  }

  // The caller's own devices, online or not; a Box carries its machine's state.
  routes.get('/devices', async (c) => {
    const userId = c.get('userId')
    const devices = await deps.listDevices(userId)
    const demand = c.req.query('metrics') === 'true'

    return c.json({
      boxAvailable: deps.box?.available() ?? false,
      devices: (
        await Promise.all(
          devices.map(async (device) => {
            const view = await deviceView(deps, device)

            return view
              ? {
                  ...view,
                  ...(view.online
                    ? await readBoxMetrics(userId, device.deviceId, demand)
                    : { metrics: null, metricsStatus: 'offline', metricsReceivedAt: null }),
                }
              : null
          }),
        )
      ).filter((view) => view !== null),
    })
  })

  // A Box: a cloud machine made for this user, joined with its own one-time token.
  routes.post('/devices/boxes', zv('json', boxCreateSchema), async (c) => {
    const box = requireBoxes()
    const { label, teamId: requestedTeamId } = c.req.valid('json')
    const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, requestedTeamId))

    if (!teamId) throw new AppError(400, 'team_required', 'A Box is made inside one of your teams')
    const device = await box.create(
      c.get('userId'),
      teamId,
      label ?? nextBoxLabel((await deps.listDevices(c.get('userId'))).map((d) => d.label)),
    )

    return c.json(await viewOrGone(device), 201)
  })

  // The Box's desktop, to watch and take over what its agents do.
  routes.post('/devices/:deviceId/box/desktop', zv('param', deviceParam), async (c) => {
    const url = await requireBoxes().desktop(c.get('userId'), c.req.valid('param').deviceId)

    return c.json({ url })
  })

  // Rename any of the caller's own devices, a Box or a computer.
  routes.patch(
    '/devices/:deviceId',
    zv('param', deviceParam),
    zv('json', z.object({ label: z.string().trim().min(1).max(200) })),
    async (c) => {
      const { deviceId } = c.req.valid('param')
      const { label } = c.req.valid('json')

      if (!(await deps.renameDevice(c.get('userId'), deviceId, label)))
        throw new AppError(404, 'not_found', `No device ${deviceId}`)

      return c.json({ ok: true })
    },
  )

  routes.post('/devices/:deviceId/box/pause', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const device = await requireBoxes().pause(userId, c.req.valid('param').deviceId)

    return c.json(await viewOrGone(device, false))
  })

  routes.post('/devices/:deviceId/box/resume', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const device = await requireBoxes().resume(userId, c.req.valid('param').deviceId)

    return c.json(await viewOrGone(device))
  })

  // Deletes the machine, revokes its credential and forgets the device.
  routes.delete('/devices/:deviceId/box', zv('param', deviceParam), async (c) => {
    const userId = c.get('userId')
    const { deviceId } = c.req.valid('param')

    await requireBoxes().destroy(userId, deviceId)
    if (await deps.revokeCredential(userId, deviceId)) await deps.disconnect(userId, deviceId)
    await deps.deleteDevice(userId, deviceId)

    return c.json({ ok: true })
  })

  return routes
}
